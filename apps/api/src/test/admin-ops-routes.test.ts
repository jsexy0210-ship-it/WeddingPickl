import { createTestApp, resetDatabase, signInAs, type TestApp } from './helpers';
import { DISCLOSURE_THRESHOLDS } from '@weddingpick/domain';
import { publishTerms } from '../admin-ops';

let test: TestApp;

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * 관리자 콘솔 «운영 · 시스템» 계열 라우트.
 *
 * 여기서 보는 것은 둘이다.
 *
 *   1. **화면이 부르는 대로 서버가 받는가.** 주소 · 메서드 · 본문 · 응답 모양을
 *      `apps/mobile/src/app/admin/`의 `apiFetch(` 자리와 맞춰 본다. 화면이 PATCH를
 *      보내는데 서버가 POST만 받으면 단추는 잠긴 것과 같다.
 *   2. **가드가 실제로 잡는가.** 롤백은 승인 없이 실행될 수 없고, 공개된 약관은
 *      고쳐지지 않으며, 광고 실운영 승인은 «켜짐»을 만들지 않는다.
 *
 * 2번은 라우트와 스키마 두 겹으로 막혀 있다. **두 겹을 각각 확인한다** — 라우트만
 * 보면 나중에 그 한 줄이 지워졌을 때 아무도 모른다.
 */
describeWithDb('관리자 운영·시스템 라우트', () => {
  beforeAll(async () => {
    await resetDatabase();
    test = await createTestApp();
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(resetDatabase);

  async function operatorHeaders(subject = `operator-${Math.random()}`) {
    const session = await signInAs(test, subject);
    await test.pool.query('UPDATE structured.users SET is_operator = true WHERE id = $1', [
      session.userId,
    ]);
    return session;
  }

  const get = (url: string, headers: Record<string, string>) =>
    test.app.inject({ method: 'GET', url, headers });
  const post = (url: string, headers: Record<string, string>, payload?: Record<string, unknown>) =>
    test.app.inject({ method: 'POST', url, headers, payload });
  const patch = (url: string, headers: Record<string, string>, payload?: Record<string, unknown>) =>
    test.app.inject({ method: 'PATCH', url, headers, payload });
  const put = (url: string, headers: Record<string, string>, payload?: Record<string, unknown>) =>
    test.app.inject({ method: 'PUT', url, headers, payload });

  /** 실패한 결정 한 줄. DLQ와 복구가 셀 대상이다. */
  async function failedDecision(workflow: string): Promise<string> {
    const { rows } = await test.pool.query<{ id: string }>(
      `INSERT INTO structured.decisions
         (event_id, workflow, step, subject_kind, decider, rule_version,
          decision, reason_code, policy_version, execution_status)
       VALUES (gen_random_uuid(), $1, 'run', 'test_subject', 'rule', 'v1',
               'failed', 'boom', 'v1', 'failed')
       RETURNING id`,
      [workflow]
    );
    return rows[0]!.id;
  }

  // ── 자동화 상태 ─────────────────────────────────────────────

  describe('자동화 상태', () => {
    it('화면이 읽는 모양으로 준다 — overall과 workflows', async () => {
      const operator = await operatorHeaders();

      const body = (await get('/v1/admin/automation', operator.headers)).json() as {
        overall: { healthyCount: number; degradedCount: number; downCount: number };
        workflows: { id: string; status: string; successRate: number; dlqSize: number }[];
      };

      expect(body.workflows.length).toBeGreaterThan(0);
      expect(body.overall.healthyCount).toBe(body.workflows.length);
      // 한 번도 돌지 않은 워크플로를 0%로 읽지 않는다. 그러면 전부 «중단»이 된다.
      expect(body.workflows.every((w) => w.successRate === 1)).toBe(true);
    });

    it('복구는 실패한 줄을 지우지 않고 대기로 되돌린다', async () => {
      const operator = await operatorHeaders();
      const decisionId = await failedDecision('reward');

      const response = await post('/v1/admin/automation/reward/recover', operator.headers);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ requeued: 1 });

      const { rows } = await test.pool.query<{ execution_status: string }>(
        'SELECT execution_status FROM structured.decisions WHERE id = $1',
        [decisionId]
      );
      // 줄이 남아 있다. 감사 기록을 지우지 않는다.
      expect(rows[0]?.execution_status).toBe('pending');
    });

    it('DLQ 비우기는 지우는 것이 아니라 «확인함»을 적는다', async () => {
      const operator = await operatorHeaders();
      const decisionId = await failedDecision('review_report');

      const response = await post('/v1/admin/automation/review_report/drain-dlq', operator.headers);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ drained: 1 });

      const { rows } = await test.pool.query<{
        execution_status: string;
        dlq_drained_at: Date | null;
      }>('SELECT execution_status, dlq_drained_at FROM structured.decisions WHERE id = $1', [
        decisionId,
      ]);
      expect(rows[0]?.execution_status).toBe('failed');
      expect(rows[0]?.dlq_drained_at).not.toBeNull();

      const body = (await get('/v1/admin/automation', operator.headers)).json() as {
        workflows: { id: string; dlqSize: number }[];
      };
      expect(body.workflows.find((w) => w.id === 'review_report')?.dlqSize).toBe(0);
    });

    it('없는 워크플로는 404다', async () => {
      const operator = await operatorHeaders();
      const response = await post('/v1/admin/automation/no-such-flow/recover', operator.headers);
      expect(response.statusCode).toBe(404);
    });

    it('운영자가 아니면 403이다', async () => {
      const outsider = await signInAs(test, `outsider-${Math.random()}`);
      const response = await post('/v1/admin/automation/reward/recover', outsider.headers);
      expect(response.statusCode).toBe(403);
    });
  });

  // ── 정책 규칙 ───────────────────────────────────────────────

  describe('정책 규칙', () => {
    /*
     * 화면(`policy-engine.tsx`)은 고친 줄을 `draft`에 모아 «변경 사항 저장» 한 번으로
     * 보낸다 — 주소에 id가 없고 본문에 `changes` 배열이 온다.
     */
    it('화면이 보내는 batch PATCH를 받는다', async () => {
      const operator = await operatorHeaders();

      const response = await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [
          { key: 'automation.dlq_alert_size', value: '4' },
          { key: 'automation.success_rate_down', value: '0.7' },
        ],
      });

      expect(response.statusCode).toBe(204);

      const body = (await get('/v1/admin/policy-engine', operator.headers)).json() as {
        policies: { key: string; value: string; defaultValue: string }[];
      };
      expect(body.policies.find((p) => p.key === 'automation.dlq_alert_size')).toMatchObject({
        value: '4',
        defaultValue: '10',
      });
      expect(body.policies.find((p) => p.key === 'automation.success_rate_down')?.value).toBe('0.7');
    });

    /*
     * 한 트랜잭션이다. 중간이 틀리면 앞의 것도 남지 않는다 — 앞의 것만 적용되면
     * 화면이 보여주는 값과 표가 갈라진다.
     */
    it('한 줄이 틀리면 같이 보낸 것도 남지 않는다', async () => {
      const operator = await operatorHeaders();

      const response = await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [
          { key: 'automation.dlq_alert_size', value: '4' },
          { key: 'automation.success_rate_down', value: '80' },
        ],
      });
      expect(response.statusCode).toBe(400);

      const body = (await get('/v1/admin/policy-engine', operator.headers)).json() as {
        policies: { key: string; value: string }[];
      };
      expect(body.policies.find((p) => p.key === 'automation.dlq_alert_size')?.value).toBe('10');
    });

    it('실제 공개에 연결되지 않은 기준은 수정할 수 없다', async () => {
      const operator = await operatorHeaders();

      /*
       * 이 시험이 지키는 것은 「고쳐도 아무 일도 안 일어나는 값을 두지 않는다」이다.
       * 0095가 `wired` 열을 만들어야 했던 이유와 같다.
       */
      const before = (await get('/v1/admin/data/price-stats', operator.headers)).json() as {
        summary: { stage0: number };
      };
      expect(before.summary).toBeDefined();

      const response = await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [{ key: 'public_stage.stage1_min', value: '99' }],
      });
      expect(response.statusCode).toBe(400);
      const rules = (await get('/v1/admin/policy-engine', operator.headers)).json() as {
        policies: { key: string; value: string; readOnlyReason: string | null }[];
      };
      expect(rules.policies.find((p) => p.key === 'public_stage.stage1_min')).toMatchObject({
        value: '3', readOnlyReason: expect.any(String),
      });

      const after = (await get('/v1/admin/data/price-stats', operator.headers)).json() as {
        summary: unknown;
      };
      expect(after.summary).toBeDefined();
    });

    it('숫자 칸에 말을 넣으면 거부한다', async () => {
      const operator = await operatorHeaders();
      const response = await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [{ key: 'automation.dlq_alert_size', value: '곧' }],
      });
      expect(response.statusCode).toBe(400);
    });

    it('비율은 0과 1 사이만 받는다', async () => {
      const operator = await operatorHeaders();
      const response = await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [{ key: 'automation.success_rate_down', value: '80' }],
      });
      expect(response.statusCode).toBe(400);
    });

    it('고치면 되돌릴 자리가 하나 생긴다', async () => {
      const operator = await operatorHeaders();

      await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [{ key: 'automation.dlq_alert_size', value: '6' }],
      });

      const body = (await get('/v1/admin/rollback', operator.headers)).json() as {
        items: { type: string; status: string; requiresApproval: boolean }[];
      };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ type: 'policy', requiresApproval: true });
    });
  });

  // ── 공개 기준 반례 검수 (2026-09-11) ─────────────────────────

  describe('공개 기준 차단을 반례로 뚫어본다', () => {
    /**
     * 정상 키 여럿과 공개 기준 하나를 섞어 보낸다.
     *
     * 가드가 루프 안에 있었다면 앞의 것들만 써지고 뒤에서 막혀 **부분 적용**이 남는다.
     * 화면은 「저장됨」과 「실패」를 동시에 보이게 되고, 어느 값이 살아 있는지 아무도 모른다.
     */
    it('정상 키 뒤에 섞어 보내도 앞의 값이 남지 않는다', async () => {
      const operator = await operatorHeaders();

      const response = await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [
          { key: 'automation.dlq_alert_size', value: '20' },
          { key: 'automation.success_rate_degraded', value: '0.9' },
          { key: 'public_stage.stage2_min', value: '99' },
        ],
      });
      expect(response.statusCode).toBe(400);

      const body = (await get('/v1/admin/policy-engine', operator.headers)).json() as {
        policies: { key: string; value: string }[];
      };
      const valueOf = (key: string) => body.policies.find((p) => p.key === key)?.value;

      expect(valueOf('automation.dlq_alert_size')).toBe('10');
      expect(valueOf('automation.success_rate_degraded')).toBe('0.95');
      expect(valueOf('public_stage.stage2_min')).toBe(String(DISCLOSURE_THRESHOLDS.normal));

      // 되돌릴 자리도 생기지 않았다 — 쓰이지 않은 변경의 롤백 대상이 남으면 그것이 다음 혼란이다.
      const { rows } = await test.pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM structured.rollback_targets WHERE kind = 'policy'`
      );
      expect(rows[0]!.n).toBe('0');
    });

    /** 이름을 비틀어 가드를 지나가도 DB의 값은 그대로다. */
    it.each([
      'public_stage.stage3_min ',
      ' public_stage.stage3_min',
      'PUBLIC_STAGE.STAGE3_MIN',
    ])('%j로 비틀어 보내도 값이 바뀌지 않는다', async (key) => {
      const operator = await operatorHeaders();

      const response = await patch('/v1/admin/policy-engine', operator.headers, {
        changes: [{ key, value: '99' }],
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);

      const { rows } = await test.pool.query<{ value: string }>(
        `SELECT value FROM structured.policy_rules WHERE key = 'public_stage.stage3_min'`
      );
      expect(rows[0]!.value).toBe(String(DISCLOSURE_THRESHOLDS.detailed));
    });

    /**
     * 관리자 통계의 사다리가 domain과 **정말** 같은가.
     *
     * 경계에서만 갈린다. 2·3·4 / 4·5·6 / 9·10·11을 넣어 단계가 어디서 올라가는지 본다 —
     * 「3/5/10을 쓴다」고 적어 두는 것과 3에서 실제로 올라가는 것은 다른 말이다.
     */
    it.each([
      [2, 0], [3, 1], [4, 1],
      [4, 1], [5, 2], [6, 2],
      [9, 2], [10, 3], [11, 3],
    ])('실 제보 %i건이면 공개 단계는 %i다', async (count, expected) => {
      const operator = await operatorHeaders();

      const { rows } = await test.pool.query<{ id: string }>(
        `INSERT INTO structured.vendors (name, category, region, source)
         VALUES ('경계 업체 ' || gen_random_uuid(), 'etc', '서울', 'public_data')
         RETURNING id`
      );
      const vendorId = rows[0]!.id;

      for (let i = 0; i < count; i += 1) {
        await test.pool.query(
          `INSERT INTO structured.payment_proofs
             (reporter_user_id, vendor_id, merchant_name, paid_amount, paid_at)
           VALUES ($1, $2, '경계 결제', 1000000, now())`,
          [operator.userId, vendorId]
        );
      }

      const body = (await get('/v1/admin/data/price-stats', operator.headers)).json() as {
        vendors: { vendorId: string; dataCount: number; publicStage: number }[];
      };
      const found = body.vendors.find((v) => v.vendorId === vendorId);

      expect(found).toMatchObject({ dataCount: count, publicStage: expected });
    });
  });


  // ── 롤백 ────────────────────────────────────────────────────

  describe('롤백', () => {
    async function policyRollbackTarget(headers: Record<string, string>): Promise<string> {
      await patch('/v1/admin/policy-engine', headers, {
        changes: [{ key: 'automation.dlq_alert_size', value: '12' }],
      });
      const { rows } = await test.pool.query<{ id: string }>(
        'SELECT id FROM structured.rollback_targets LIMIT 1'
      );
      return rows[0]!.id;
    }

    it('승인하지 않은 롤백은 실행되지 않는다', async () => {
      const operator = await operatorHeaders();
      const id = await policyRollbackTarget(operator.headers);

      const response = await post(`/v1/admin/rollback/${id}/trigger`, operator.headers);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { message: expect.stringContaining('승인') },
      });

      const { rows } = await test.pool.query<{ triggered_at: Date | null }>(
        'SELECT triggered_at FROM structured.rollback_targets WHERE id = $1',
        [id]
      );
      expect(rows[0]?.triggered_at).toBeNull();
    });

    /*
     * **가드를 도로 빼고 확인한 자리.** 라우트의 `if (!found.approved_at)`를 지운
     * 채로 이 흐름을 돌리면 라우트는 통과하고, 대신 0130의
     * `trigger_follows_approval`이 쓰기를 거부한다 — 두 겹이 각각 산다.
     *
     * 여기서는 스키마 쪽만 따로 겨눈다. 라우트를 지나지 않고 직접 쓴다.
     */
    it('스키마가 승인 없는 실행을 거부한다 — 라우트를 지나지 않아도', async () => {
      const operator = await operatorHeaders();
      const id = await policyRollbackTarget(operator.headers);

      await expect(
        test.pool.query(
          `UPDATE structured.rollback_targets
           SET triggered_at = now(), triggered_by = $2::uuid, trigger_reason = '몰래'
           WHERE id = $1`,
          [id, operator.userId]
        )
      ).rejects.toThrow(/trigger_follows_approval/);
    });

    it('두 단계를 거치면 정책 값이 실제로 되돌아간다', async () => {
      const operator = await operatorHeaders();
      const id = await policyRollbackTarget(operator.headers);

      expect((await post(`/v1/admin/rollback/${id}/approve`, operator.headers)).statusCode).toBe(
        204
      );

      const triggered = await post(`/v1/admin/rollback/${id}/trigger`, operator.headers);
      expect(triggered.statusCode).toBe(200);
      expect(triggered.json()).toMatchObject({ restored: true });

      const { rows } = await test.pool.query<{ value: string }>(
        `SELECT value FROM structured.policy_rules WHERE id = 'automation.dlq_alert_size'`
      );
      expect(rows[0]?.value).toBe('10');
    });

    it('승인 뒤에야 화면에 실행 단추가 뜬다', async () => {
      const operator = await operatorHeaders();
      const id = await policyRollbackTarget(operator.headers);

      const before = (await get('/v1/admin/rollback', operator.headers)).json() as {
        items: { id: string; requiresApproval: boolean }[];
      };
      // 화면은 requiresApproval이 false일 때만 «즉시 롤백»을 그린다.
      expect(before.items.find((i) => i.id === id)?.requiresApproval).toBe(true);

      await post(`/v1/admin/rollback/${id}/approve`, operator.headers);

      const after = (await get('/v1/admin/rollback', operator.headers)).json() as {
        items: { id: string; requiresApproval: boolean }[];
      };
      expect(after.items.find((i) => i.id === id)?.requiresApproval).toBe(false);
    });

    it('같은 롤백을 두 번 승인하지 않는다', async () => {
      const operator = await operatorHeaders();
      const id = await policyRollbackTarget(operator.headers);

      await post(`/v1/admin/rollback/${id}/approve`, operator.headers);
      const again = await post(`/v1/admin/rollback/${id}/approve`, operator.headers);

      expect(again.statusCode).toBe(400);
    });
  });

  // ── 약관 ────────────────────────────────────────────────────

  describe('약관 · 방침', () => {
    async function draftWithClause(): Promise<{ versionId: string; clauseId: string }> {
      const { rows: version } = await test.pool.query<{ id: string }>(
        `INSERT INTO structured.terms_versions (doc, version) VALUES ('terms', 'v1.0') RETURNING id`
      );
      const { rows: clause } = await test.pool.query<{ id: string }>(
        `INSERT INTO structured.terms_clauses (version_id, article_number, title, body, position)
         VALUES ($1, '제1조', '목적', '처음 내용', 0) RETURNING id`,
        [version[0]!.id]
      );
      return { versionId: version[0]!.id, clauseId: clause[0]!.id };
    }

    it('앱 약관 연결 전에는 조문 편집을 거부하고 원문을 보존한다', async () => {
      const operator = await operatorHeaders();
      const { clauseId } = await draftWithClause();

      const response = await put(
        `/v1/admin/terms/terms/clauses/${clauseId}`,
        operator.headers,
        { body: '고친 내용' }
      );
      expect(response.statusCode).toBe(400);

      const body = (await get('/v1/admin/terms', operator.headers)).json() as {
        documents: { type: string; clauses: { body: string }[] }[];
      };
      expect(body.documents.find((d) => d.type === 'terms')?.clauses[0]?.body).toBe('처음 내용');
    });

    it('내부 공개 함수는 판을 보존하고 다음 초안을 만든다', async () => {
      const operator = await operatorHeaders();
      await draftWithClause();

      const published = await publishTerms(test.pool, 'terms', operator.userId, '분리된 DB 검증');
      expect(published).toMatchObject({ version: 'v1.0', nextDraft: 'v1.1' });

      const body = (await get('/v1/admin/terms', operator.headers)).json() as {
        documents: { type: string; currentVersion: string; latestDraftVersion: string | null }[];
      };
      const doc = body.documents.find((d) => d.type === 'terms');
      expect(doc?.currentVersion).toBe('v1.0');
      // 새 초안이 없으면 공개 직후 그 문서는 편집할 수 없는 상태가 된다.
      expect(doc?.latestDraftVersion).toBe('v1.1');
    });

    it('공개된 판의 조문은 라우트가 거부한다', async () => {
      const operator = await operatorHeaders();
      const { clauseId } = await draftWithClause();
      await publishTerms(test.pool, 'terms', operator.userId, '분리된 DB 검증');

      const response = await put(
        `/v1/admin/terms/terms/clauses/${clauseId}`,
        operator.headers,
        { body: '몰래 고침' }
      );
      expect(response.statusCode).toBe(400);
    });

    /*
     * **가드를 도로 빼고 확인한 자리.** 라우트의 `if (found.published_at !== null)`을
     * 지우면 위 시험은 통과해 버린다. 그때 막는 것이 0130의 트리거다.
     */
    it('스키마 트리거가 공개된 판의 조문 쓰기를 거부한다', async () => {
      const operator = await operatorHeaders();
      const { clauseId } = await draftWithClause();
      await publishTerms(test.pool, 'terms', operator.userId, '분리된 DB 검증');

      await expect(
        test.pool.query('UPDATE structured.terms_clauses SET body = $2 WHERE id = $1', [
          clauseId,
          '몰래 고침',
        ])
      ).rejects.toThrow(/공개된 판/);
    });

    it('공개할 초안이 없으면 거부한다', async () => {
      const operator = await operatorHeaders();
      const response = await post('/v1/admin/terms/privacy/publish', operator.headers);
      expect(response.statusCode).toBe(400);
    });

    it('없는 문서 갈래는 404다', async () => {
      const operator = await operatorHeaders();
      const response = await post('/v1/admin/terms/no-such-doc/publish', operator.headers);
      expect(response.statusCode).toBe(404);
    });
  });

  // ── 광고 실운영 게이트 ───────────────────────────────────────

  describe('광고 실운영 전환 게이트', () => {
    async function bothReports(): Promise<void> {
      await test.pool.query(
        `INSERT INTO ads.launch_reports (tier, analyst, verdict, recommended_on, findings)
         VALUES ('light', 'gpt', 'open', current_date, '{"ctr": "측정값"}'::jsonb),
                ('light', 'claude', 'hold', NULL, '{"ctr": "측정값"}'::jsonb)`
      );
    }

    it('보고서 2건이 없으면 승인하지 않는다', async () => {
      const operator = await operatorHeaders();
      const response = await post('/v1/admin/ads-gate/approve', operator.headers);
      expect(response.statusCode).toBe(400);
    });

    /**
     * **승인은 전환이 아니다.** 켜는 길이 생긴 뒤에도(2026-09-11 대표 지시) 이것은
     * 그대로다 — 승인 단추 하나로 광고가 나가면 「열기로 정했다」와 「지금 나간다」가
     * 한 번의 실수로 붙는다.
     */
    it('승인해도 실운영은 꺼진 채다', async () => {
      const operator = await operatorHeaders();
      await bothReports();

      const response = await post('/v1/admin/ads-gate/approve', operator.headers);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ activated: false });

      const { rows } = await test.pool.query<{ activated: boolean; approved_at: Date | null }>(
        'SELECT activated, approved_at FROM ads.production_gate WHERE id = true'
      );
      expect(rows[0]?.approved_at).not.toBeNull();
      expect(rows[0]?.activated).toBe(false);

      const gate = (await get('/v1/admin/ads-gate', operator.headers)).json() as {
        steps: { id: string; status: string }[];
        readyForProduction: boolean;
        activated: boolean;
        canActivate: boolean;
      };
      /* 승인 뒤에는 「켤 수 있음」이다. 켜진 것이 아니다. */
      expect(gate.steps.find((s) => s.id === 'production')?.status).toBe('in_progress');
      expect(gate.activated).toBe(false);
      expect(gate.canActivate).toBe(true);
      expect(gate.readyForProduction).toBe(false);
    });

    /**
     * 두 겹으로 막혀 있다 — 라우트가 먼저 보고, 그 줄이 없어도 스키마의
     * `activation_follows_approval`이 막는다.
     *
     * **그래서 상태 코드만 보면 라우트 가드를 확인하지 못한다.** 가드를 빼고
     * 돌려 보니 여전히 400이었다(2026-09-11 실측). 라우트가 하는 일은 막는 것이
     * 아니라 **왜 막혔는지 사람에게 말해 주는 것**이라, 그 말을 확인한다 —
     * 제약이 던지는 오류는 이유를 알려주지 않는다.
     */
    it('승인 전에는 켤 수 없고, 왜 막혔는지 말해 준다', async () => {
      const operator = await operatorHeaders();

      const response = await post('/v1/admin/ads-gate/activate', operator.headers);
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { message: string } }>().error.message).toContain('먼저 승인');

      const { rows } = await test.pool.query<{ activated: boolean }>(
        'SELECT activated FROM ads.production_gate WHERE id = true'
      );
      expect(rows[0]?.activated).toBe(false);
    });

    /**
     * 2026-09-11 대표 지시 — 「광고도 진행해. 단, 관리자에서 내가 컨트롤할 수 있어야
     * 한다」. **켜는 것과 끄는 것이 둘 다 있어야 컨트롤이다.**
     */
    it('승인 뒤에는 켜고 다시 끌 수 있다', async () => {
      const operator = await operatorHeaders();
      await bothReports();
      await post('/v1/admin/ads-gate/approve', operator.headers);

      const on = await post('/v1/admin/ads-gate/activate', operator.headers);
      expect(on.statusCode).toBe(200);
      expect(on.json()).toMatchObject({ activated: true });

      const afterOn = (await get('/v1/admin/ads-gate', operator.headers)).json() as {
        activated: boolean;
        canActivate: boolean;
        steps: { id: string; status: string }[];
      };
      expect(afterOn.activated).toBe(true);
      expect(afterOn.canActivate).toBe(false);
      expect(afterOn.steps.find((s) => s.id === 'production')?.status).toBe('done');

      const off = await post('/v1/admin/ads-gate/deactivate', operator.headers);
      expect(off.statusCode).toBe(200);
      expect(off.json()).toMatchObject({ activated: false });

      /* 끄는 것과 승인을 무르는 것은 다른 일이다 — 승인 기록은 남는다. */
      const { rows } = await test.pool.query<{ activated: boolean; approved_at: Date | null }>(
        'SELECT activated, approved_at FROM ads.production_gate WHERE id = true'
      );
      expect(rows[0]?.activated).toBe(false);
      expect(rows[0]?.approved_at).not.toBeNull();
    });

    it('이미 켜진 것을 또 켜지 않는다', async () => {
      const operator = await operatorHeaders();
      await bothReports();
      await post('/v1/admin/ads-gate/approve', operator.headers);
      await post('/v1/admin/ads-gate/activate', operator.headers);

      const again = await post('/v1/admin/ads-gate/activate', operator.headers);
      expect(again.statusCode).toBe(400);
    });

    it('두 번 승인하지 않는다', async () => {
      const operator = await operatorHeaders();
      await bothReports();

      await post('/v1/admin/ads-gate/approve', operator.headers);
      const again = await post('/v1/admin/ads-gate/approve', operator.headers);
      expect(again.statusCode).toBe(400);
    });

    it('승인 없이는 켜짐이 될 수 없다 — 스키마가 막는다', async () => {
      await expect(
        test.pool.query(
          'UPDATE ads.production_gate SET activated = true, activated_at = now() WHERE id = true'
        )
      ).rejects.toThrow(/activation_follows_approval/);
    });
  });

  // ── 광고 상품(등급)별 실운영 상태 ────────────────────────────

  /**
   * **검색 화면이 실제로 보는 스위치가 이것이다**(`routes/vendors.ts`가
   * `ads.tier_state`를 `state = 'live'`로 건다). 전체 관문과 다른 자리라 따로 본다.
   */
  describe('광고 상품별 실운영 상태', () => {
    const tiersOf = (body: unknown) => (body as { tiers: { tier: string; state: string }[] }).tiers;
    const stateOf = (body: unknown, tier: string) =>
      tiersOf(body).find((t) => t.tier === tier)?.state;

    it('아무것도 안 정하면 전부 테스트다', async () => {
      const operator = await operatorHeaders();

      const response = await get('/v1/admin/ad-tiers', operator.headers);
      expect(response.statusCode).toBe(200);

      const tiers = tiersOf(response.json());
      expect(tiers.length).toBeGreaterThan(0);
      expect(tiers.every((t) => t.state === 'test')).toBe(true);
    });

    it('실운영으로 열고 테스트로 되돌린다', async () => {
      const operator = await operatorHeaders();

      const opened = await put('/v1/admin/ad-tiers/standard', operator.headers, { state: 'live' });
      expect(opened.statusCode).toBe(200);
      expect(stateOf(opened.json(), 'standard')).toBe('live');
      /* 한 등급을 연다고 다른 등급이 따라 열리지 않는다. */
      expect(stateOf(opened.json(), 'light')).toBe('test');

      const back = await test.app.inject({
        method: 'DELETE',
        url: '/v1/admin/ad-tiers/standard',
        headers: operator.headers,
      });
      expect(back.statusCode).toBe(200);
      expect(stateOf(back.json(), 'standard')).toBe('test');
    });

    it('사람 없이 실운영이 되지 않는다 — 정한 사람이 남는다', async () => {
      const operator = await operatorHeaders();
      await put('/v1/admin/ad-tiers/light', operator.headers, { state: 'live' });

      const { rows } = await test.pool.query<{ decided_by: string | null }>(
        "SELECT decided_by FROM ads.launch_decisions WHERE tier = 'light'"
      );
      expect(rows[0]?.decided_by).toBe(operator.userId);
    });

    /*
     * test는 시작 상태이지 결정이 아니다. 표의 `decision_is_not_test`가 막고 있고,
     * 라우트 스키마도 받지 않는다 — 두 겹을 각각 확인한다.
     */
    it('test를 결정으로 적지 않는다 — 라우트가 막는다', async () => {
      const operator = await operatorHeaders();

      const response = await put('/v1/admin/ad-tiers/light', operator.headers, { state: 'test' });
      expect(response.statusCode).toBe(400);
    });

    it('test를 결정으로 적지 않는다 — 스키마가 막는다', async () => {
      const person = await test.pool.query<{ id: string }>(
        'INSERT INTO structured.users DEFAULT VALUES RETURNING id'
      );

      await expect(
        test.pool.query(
          `INSERT INTO ads.launch_decisions (tier, state, decided_by)
           VALUES ('light', 'test', $1::uuid)`,
          [person.rows[0]!.id]
        )
      ).rejects.toThrow(/decision_is_not_test/);
    });

    it('이미 테스트인 것을 또 되돌리지 않는다', async () => {
      const operator = await operatorHeaders();

      const response = await test.app.inject({
        method: 'DELETE',
        url: '/v1/admin/ad-tiers/premium',
        headers: operator.headers,
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── 감사 기록 ───────────────────────────────────────────────

  describe('감사 기록', () => {
    it('화면이 읽는 칸 이름으로 준다', async () => {
      const operator = await operatorHeaders();
      await failedDecision('reward');

      const body = (await get('/v1/admin/audit-log', operator.headers)).json() as {
        items: { eventId: string; decision: string; actorType: string; evidence: string[] }[];
        total: number;
        hasMore: boolean;
        cursor: string | null;
      };

      expect(body.total).toBeGreaterThan(0);
      expect(body.hasMore).toBe(false);
      expect(body.cursor).toBeNull();
      expect(body.items[0]).toMatchObject({
        // 실패한 결정은 사람에게 넘어간 것이다.
        decision: 'escalated',
        actorType: 'system',
      });
      expect(Array.isArray(body.items[0]?.evidence)).toBe(true);
    });

    it('화면이 보내는 ?q= 로 찾는다', async () => {
      const operator = await operatorHeaders();
      await failedDecision('reward');
      await failedDecision('vendor_claim');

      const hit = (await get('/v1/admin/audit-log?q=vendor_claim', operator.headers)).json() as {
        items: { targetType: string }[];
        total: number;
      };
      expect(hit.total).toBe(1);

      const miss = (await get('/v1/admin/audit-log?q=없는말', operator.headers)).json() as {
        total: number;
      };
      expect(miss.total).toBe(0);
    });
  });

  // ── 캠페인 · 광고 집행 ──────────────────────────────────────

  describe('캠페인 · 광고 집행', () => {
    it('캠페인 목록은 화면이 읽는 모양이고, 예산은 지어내지 않는다', async () => {
      const operator = await operatorHeaders();

      const body = (await get('/v1/admin/campaigns', operator.headers)).json() as {
        items: unknown[];
        budget?: unknown;
      };

      expect(Array.isArray(body.items)).toBe(true);
      // 예산을 담는 표가 없다. 0으로 적으면 「예산 0원」이 사실처럼 읽힌다.
      expect(body.budget).toBeUndefined();
    });

    it('지급·차단이 아닌 말은 거부한다', async () => {
      const operator = await operatorHeaders();
      const response = await post(
        '/v1/admin/campaigns/00000000-0000-0000-0000-000000000000/delete',
        operator.headers
      );
      expect(response.statusCode).toBe(400);
    });

    it('광고 상태는 화면이 보내는 PATCH로 바꾼다', async () => {
      const operator = await operatorHeaders();

      const { rows: vendor } = await test.pool.query<{ id: string }>(
        `INSERT INTO structured.vendors (name, category, region, source)
         VALUES ('강남 A 스튜디오', 'studio', '서울', 'public_data') RETURNING id`
      );
      const { rows: placement } = await test.pool.query<{ id: string }>(
        `INSERT INTO ads.placements (vendor_id, surface, tier, starts_on, ends_on)
         VALUES ($1, 'vendor_detail', 'light', current_date - 1, current_date + 30) RETURNING id`,
        [vendor[0]!.id]
      );
      const id = placement[0]!.id;

      const listed = (await get('/v1/admin/ads', operator.headers)).json() as {
        items: { id: string; status: string }[];
      };
      expect(listed.items.find((i) => i.id === id)?.status).toBe('active');

      const paused = await patch(`/v1/admin/ads/${id}/status`, operator.headers, {
        status: 'paused',
      });
      expect(paused.statusCode).toBe(204);

      const after = (await get('/v1/admin/ads', operator.headers)).json() as {
        items: { id: string; status: string }[];
      };
      expect(after.items.find((i) => i.id === id)?.status).toBe('paused');

      /*
       * 멈춘 광고는 사용자에게 보이지 않아야 한다. 화면에는 «일시정지»인데
       * 사용자에게는 계속 나가는 것이 가장 나쁜 자리다.
       */
      const { rows: active } = await test.pool.query(
        'SELECT id FROM ads.active_placements WHERE id = $1',
        [id]
      );
      expect(active).toHaveLength(0);

      // 기간은 손대지 않는다. 돈이 오간 약속이다.
      const { rows: kept } = await test.pool.query<{ starts_on: Date; ends_on: Date }>(
        'SELECT starts_on, ends_on FROM ads.placements WHERE id = $1',
        [id]
      );
      expect(kept[0]?.starts_on).not.toBeNull();

      const resumed = await patch(`/v1/admin/ads/${id}/status`, operator.headers, {
        status: 'active',
      });
      expect(resumed.statusCode).toBe(204);

      const again = await patch(`/v1/admin/ads/${id}/status`, operator.headers, {
        status: 'active',
      });
      expect(again.statusCode).toBe(400);
    });
  });
});
