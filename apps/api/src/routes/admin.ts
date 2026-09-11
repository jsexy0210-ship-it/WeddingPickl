import { randomUUID } from 'node:crypto';

import { isFeature } from '../ai-cost-admin';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { MarketingChannel, MarketingFormat } from '@weddingpick/api-contract';
import { disclosureStage, type DisclosureStage } from '@weddingpick/domain';
import * as marketingContent from '../marketing/content';
import * as marketingStore from '../marketing/store';
import * as adAdmin from '../ad-admin';
import * as adminOps from '../admin-ops';
import * as aiCostAdmin from '../ai-cost-admin';
import { currentUserId, requireOperatorUser } from '../auth/plugin';
import { isKnownSourceKey } from '../public-data/sources';
import type { AppContext } from '../context';
import * as dashboardAdmin from '../dashboard-admin';
import * as decisionsAdmin from '../decisions-admin';
import * as faqAdmin from '../faq-admin';
import { NotAnOperator } from '../decisions';
import { ApiError, forbidden, notFound } from '../errors';
import * as inquiryAdmin from '../inquiry-admin';
import { holdReview, resolveObjection } from '../objection-decide';
import * as objectionAdmin from '../objection-admin';
import * as paymentProofAdmin from '../payment-proof-admin';
import * as piiAdmin from '../pii-admin';
import { decideRebuttal } from '../rebuttal-decide';
import * as rebuttalAdmin from '../rebuttal-admin';
import * as retentionWorker from '../retention/worker';
import * as rewardAdmin from '../reward-admin';
import * as dataPipeline from '../data-pipeline-admin';
import * as vendorAdmin from '../vendor-admin';
import * as vendorClaimAdmin from '../vendor-claim-admin';
import * as verificationAdmin from '../verification-admin';
import * as withdrawalAdmin from '../withdrawal-admin';

/**
 * 관리자 콘솔 라우트. 최종통합정책 v2.0 H장.
 *
 * 13개의 CLI 전용 운영 도구(`*-admin.ts`)를 그대로 HTTP 위에 올린다. 로직은
 * 이미 각 도구에 있다 — 여기서는 요청을 그 함수 호출로 바꾸고, 응답을 사람이
 * 아니라 화면이 읽는 JSON으로 바꿀 뿐이다.
 *
 * **관문은 라우트 맨 앞, 대상을 찾기도 전이다**(`requireOperatorUser`). CLI
 * 시절에는 조회(`list`/`show`)가 권한을 보지 않았다 — 서버에 접근할 수 있는
 * 사람만 CLI를 돌릴 수 있다는 것이 유일한 통제였다. HTTP로 옮기면 그 암묵적
 * 경계가 사라지므로, 조회든 결정이든 이 라우트는 전부 같은 관문을 지난다.
 *
 * 도구 함수가 던지는 일반 `Error`(예: "없는 신청이다.", "이미 처리된 상태다.")는
 * 사람이 읽으라고 쓴 말이다. `invalid_request`로 그대로 보낸다 — 안쪽 사정을
 * 감출 이유가 없다.
 *
 * **`retention --operator` 부트스트랩은 여기 없다.** 최초의 운영자를 만드는
 * 길이고, 운영자만 쓸 수 있는 라우트 안에 두면 최초의 운영자를 만들 수 없다.
 * CLI로만 남겨둔다.
 */
type KillSwitch = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: string;
  /**
   * 이 스위치를 읽는 코드가 실제로 있는가. false면 껐다 켜도 동작이 바뀌지 않는다.
   * 화면이 그 사실을 그대로 보여줘야 한다 — 끈 줄 알고 손을 놓는 것이 가장 나쁘다.
   */
  wired: boolean;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
};

/*
 * 기능 스위치는 DB(`structured.kill_switches`, 0095)에 있다. 예전에는 이 파일 안의
 * 인메모리 Map이었고 **읽는 쪽이 한 곳도 없었다** — 껐다고 표시돼도 기능은 계속 돌고
 * 재시작하면 껐다는 사실조차 사라졌다.
 */
type KillSwitchRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  wired: boolean;
  updated_at: Date | string | null;
  updated_by: string | null;
};

function toIso(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

function toFeatureKillSwitch(row: KillSwitchRow): KillSwitch {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    category: row.category,
    wired: row.wired,
    lastChangedAt: toIso(row.updated_at),
    lastChangedBy: row.updated_by,
  };
}

/*
 * 수집 중단 스위치는 위 Map과 달리 DB(`structured.import_switches`)에 있다.
 * `public-data/sync.ts`가 임포트 직전에 이 값을 읽어 `SOURCE_DISABLED`로 거부하므로,
 * 여기서 끄면 배포 없이 그 출처의 수집이 실제로 멈춘다. 프로세스 메모리에 두면
 * 재시작에 사라지고, 별도 프로세스로 도는 임포트에는 보이지도 않는다.
 */
const IMPORT_SWITCH_PREFIX = 'import:';

type ImportSwitchRow = {
  source_key: string;
  enabled: boolean;
  reason: string | null;
  updated_at: Date | string | null;
};

function toImportKillSwitch(row: ImportSwitchRow): KillSwitch {
  return {
    id: `${IMPORT_SWITCH_PREFIX}${row.source_key}`,
    name: `수집 — ${row.source_key}`,
    description: row.reason ?? '이 출처의 공개 데이터 수집을 중지합니다',
    enabled: row.enabled,
    category: '수집',
    // sync.ts가 임포트 직전에 읽는다. 수집 스위치는 전부 배선돼 있다.
    wired: true,
    lastChangedAt: toIso(row.updated_at),
    lastChangedBy: null,
  };
}

function mapCopyrightBasis(
  basis: string
): 'licensed' | 'public_domain' | 'vendor_provided' | 'vendor_homepage' | 'pending' | 'rejected' {
  if (basis === 'vendor_provided') return 'vendor_provided';
  // 업체가 자기 홈페이지에 대표 이미지로 올려 둔 것. 직접 받은 것과 구분해서 보인다.
  if (basis === 'vendor_homepage') return 'vendor_homepage';
  if (basis === 'public_domain') return 'public_domain';
  if (basis === 'unknown') return 'pending';
  if (basis.startsWith('cc_') || basis.startsWith('kogl_')) return 'licensed';
  return 'pending';
}

/** 경로 파라미터가 uuid인지. 아니면 질의가 22P02로 터져 500이 된다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerAdminRoutes(app: FastifyInstance, context: AppContext): void {
  const auth = { preHandler: requireOperatorUser(context) };

  /** 도구 함수의 일반 Error를 사람이 읽는 400으로 바꾼다. */
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof NotAnOperator) throw forbidden();
      if (error instanceof Error) throw new ApiError('invalid_request', error.message);
      throw error;
    }
  }

  /*
   * 운영 · 시스템 계열 단추가 보내는 본문.
   *
   * **사유는 선택이다.** 화면이 아직 사유 칸을 그리지 않는 자리가 있고, 그것을
   * 이유로 라우트를 막으면 단추가 눌리지 않는 채로 남는다. 대신 서버가 「관리자
   * 콘솔에서 처리」를 적어 기록이 비지 않게 한다 — 사유 없는 줄을 남기지 않는 것이
   * 스키마의 약속이다.
   */
  const reasonBody = z.object({ reason: z.string().trim().min(1).optional() });
  const adStatusBody = z.object({
    status: z.enum(['active', 'paused']),
    reason: z.string().trim().min(1).optional(),
  });
  const policyChangesBody = z.object({
    changes: z
      .array(z.object({ key: z.string().trim().min(1), value: z.string() }))
      .min(1),
  });

  // ── 결정 브리핑 ──────────────────────────────────────────────
  app.get('/v1/admin/decisions/briefing', auth, async () => ({
    rows: await decisionsAdmin.briefing(context.pool),
  }));

  app.get('/v1/admin/decisions/open', auth, async () => ({
    rows: await decisionsAdmin.openDecisions(context.pool),
  }));

  app.get<{ Params: { eventId: string } }>(
    '/v1/admin/decisions/events/:eventId',
    auth,
    async (request) => {
      const rows = await decisionsAdmin.eventTimeline(context.pool, request.params.eventId);
      if (rows.length === 0) throw notFound('사건');
      return { rows };
    }
  );

  // ── 반론 ────────────────────────────────────────────────────
  app.get('/v1/admin/rebuttals', auth, async () => ({
    rebuttals: await rebuttalAdmin.list(context.pool),
  }));

  app.get<{ Params: { id: string } }>('/v1/admin/rebuttals/:id', auth, async (request) => {
    const found = await rebuttalAdmin.show(context.pool, request.params.id);
    if (!found) throw notFound('반론');
    return found;
  });

  const rebuttalDecisionBodySchema = z.object({
    note: z.string().trim().min(1),
    withoutClaim: z.boolean().optional(),
  });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/rebuttals/:id/publish',
    auth,
    async (request, reply) => {
      const body = rebuttalDecisionBodySchema.parse(request.body);

      await run(() =>
        decideRebuttal(context.pool, {
          id: request.params.id,
          to: 'published',
          by: currentUserId(request),
          note: body.note,
          withoutClaim: body.withoutClaim,
        })
      );

      return reply.status(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    '/v1/admin/rebuttals/:id/reject',
    auth,
    async (request, reply) => {
      const body = rebuttalDecisionBodySchema.parse(request.body);

      await run(() =>
        decideRebuttal(context.pool, {
          id: request.params.id,
          to: 'rejected',
          by: currentUserId(request),
          note: body.note,
        })
      );

      return reply.status(204).send();
    }
  );

  // ── 후기 이의 ────────────────────────────────────────────────
  app.get('/v1/admin/objections', auth, async () => ({
    objections: await objectionAdmin.list(context.pool),
  }));

  const holdObjectionBodySchema = z.object({
    note: z.string().trim().min(1),
    days: z.number().int().positive().optional(),
  });

  app.post<{ Params: { reviewId: string } }>(
    '/v1/admin/objections/:reviewId/hold',
    auth,
    async (request, reply) => {
      const body = holdObjectionBodySchema.parse(request.body);

      await run(() =>
        holdReview(context.pool, {
          reviewId: request.params.reviewId,
          by: currentUserId(request),
          note: body.note,
          days: body.days,
        })
      );

      return reply.status(204).send();
    }
  );

  const resolveObjectionBodySchema = z.object({ note: z.string().trim().min(1) });

  for (const [path, to] of [
    ['restore', 'restore'],
    ['remove', 'remove'],
  ] as const) {
    app.post<{ Params: { reviewId: string } }>(
      `/v1/admin/objections/:reviewId/${path}`,
      auth,
      async (request, reply) => {
        const body = resolveObjectionBodySchema.parse(request.body);

        await run(() =>
          resolveObjection(context.pool, {
            reviewId: request.params.reviewId,
            to,
            by: currentUserId(request),
            note: body.note,
          })
        );

        return reply.status(204).send();
      }
    );
  }

  // ── 인증 심사 ────────────────────────────────────────────────
  app.get('/v1/admin/verifications', auth, async () => ({
    requests: await verificationAdmin.list(context.pool),
  }));

  app.get('/v1/admin/verifications/backlog', auth, async () => ({
    requests: await verificationAdmin.backlog(context.pool),
  }));

  app.get<{ Params: { id: string } }>('/v1/admin/verifications/:id', auth, async (request) => {
    const found = await verificationAdmin.show(context.pool, request.params.id);
    if (!found) throw notFound('인증 신청');
    return found;
  });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/verifications/:id/review',
    auth,
    async (request, reply) => {
      await run(() => verificationAdmin.startReview(context.pool, request.params.id, currentUserId(request)));
      return reply.status(204).send();
    }
  );

  const approveVerificationBodySchema = z.object({ note: z.string().trim().min(1).nullable().optional() });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/verifications/:id/approve',
    auth,
    async (request, reply) => {
      const body = approveVerificationBodySchema.parse(request.body ?? {});

      await run(() =>
        verificationAdmin.approve(context.pool, request.params.id, currentUserId(request), body.note ?? null)
      );

      return reply.status(204).send();
    }
  );

  const supplementVerificationBodySchema = z.object({ reason: z.string().trim().min(1) });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/verifications/:id/supplement',
    auth,
    async (request, reply) => {
      const body = supplementVerificationBodySchema.parse(request.body);
      await run(() =>
        verificationAdmin.requestSupplement(context.pool, request.params.id, currentUserId(request), body.reason)
      );
      return reply.status(204).send();
    }
  );

  const rejectVerificationBodySchema = z.object({ reason: z.string().trim().min(1) });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/verifications/:id/reject',
    auth,
    async (request, reply) => {
      const body = rejectVerificationBodySchema.parse(request.body);

      await run(() =>
        verificationAdmin.reject(context.pool, request.params.id, currentUserId(request), body.reason)
      );

      return reply.status(204).send();
    }
  );

  // ── 업체 관계자 인증 ─────────────────────────────────────────
  app.get('/v1/admin/vendor-claims', auth, async () => ({
    claims: await vendorClaimAdmin.list(context.pool),
  }));

  app.get<{ Params: { id: string } }>('/v1/admin/vendor-claims/:id', auth, async (request) => {
    const found = await vendorClaimAdmin.show(context.pool, request.params.id);
    if (!found) throw notFound('신청');
    return found;
  });

  const vendorClaimDecisionBodySchema = z.object({ note: z.string().trim().min(1) });

  for (const [path, to] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/v1/admin/vendor-claims/:id/${path}`,
      auth,
      async (request, reply) => {
        const body = vendorClaimDecisionBodySchema.parse(request.body);

        await run(() =>
          vendorClaimAdmin.decide(context.pool, request.params.id, to, currentUserId(request), body.note)
        );

        return reply.status(204).send();
      }
    );
  }

  // ── 문의 ────────────────────────────────────────────────────
  app.get('/v1/admin/inquiries', auth, async () => ({
    inquiries: await inquiryAdmin.list(context.pool),
  }));

  app.get<{ Params: { id: string } }>('/v1/admin/inquiries/:id', auth, async (request) => {
    const found = await inquiryAdmin.show(context.pool, request.params.id);
    if (!found) throw notFound('문의');
    return found;
  });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/inquiries/:id/review',
    auth,
    async (request, reply) => {
      await run(() =>
        inquiryAdmin.moveStatus(context.pool, request.params.id, 'in_review', currentUserId(request), null, false, null)
      );

      return reply.status(204).send();
    }
  );

  const answerInquiryBodySchema = z.object({
    resolution: z.string().trim().min(1),
    withdrawPlanner: z.boolean().optional(),
    listPlanner: z.boolean().optional(),
  });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/inquiries/:id/answer',
    auth,
    async (request, reply) => {
      const body = answerInquiryBodySchema.parse(request.body);

      await run(() =>
        inquiryAdmin.moveStatus(
          context.pool,
          request.params.id,
          'answered',
          currentUserId(request),
          body.resolution,
          body.withdrawPlanner ?? false,
          null,
          body.listPlanner ?? false
        )
      );

      return reply.status(204).send();
    }
  );

  // ── 개인정보 재검토 ──────────────────────────────────────────
  app.get('/v1/admin/pii-reviews', auth, async () => ({
    reviews: await piiAdmin.list(context.pool),
  }));

  app.get<{ Params: { quoteId: string } }>(
    '/v1/admin/pii-reviews/:quoteId',
    auth,
    async (request) => {
      const found = await piiAdmin.show(context.pool, request.params.quoteId);
      if (!found) throw notFound('문서');
      return found;
    }
  );

  app.post<{ Params: { quoteId: string } }>(
    '/v1/admin/pii-reviews/:quoteId/clean',
    auth,
    async (request, reply) => {
      await run(() => piiAdmin.conclude(context.pool, request.params.quoteId, currentUserId(request), 'clean'));
      return reply.status(204).send();
    }
  );

  const redactPiiBodySchema = z.object({
    field: z.string().trim().min(1),
    kind: z.string().trim().min(1),
  });

  app.post<{ Params: { quoteId: string } }>(
    '/v1/admin/pii-reviews/:quoteId/redact',
    auth,
    async (request, reply) => {
      const body = redactPiiBodySchema.parse(request.body);

      await run(() =>
        piiAdmin.redact(context.pool, request.params.quoteId, currentUserId(request), body.field, body.kind)
      );

      return reply.status(204).send();
    }
  );

  // ── 결제인증 잇기 ────────────────────────────────────────────
  app.get('/v1/admin/payment-proofs', auth, async () => ({
    proofs: await paymentProofAdmin.list(context.pool),
  }));

  app.get<{ Params: { id: string } }>('/v1/admin/payment-proofs/:id', auth, async (request) => {
    const found = await paymentProofAdmin.show(context.pool, request.params.id);
    if (!found) throw notFound('결제인증');
    return found;
  });

  const linkPaymentProofBodySchema = z.object({ vendorId: z.string().trim().min(1) });

  app.post<{ Params: { id: string } }>(
    '/v1/admin/payment-proofs/:id/link',
    auth,
    async (request, reply) => {
      const body = linkPaymentProofBodySchema.parse(request.body);

      await run(() =>
        paymentProofAdmin.link(context.pool, request.params.id, body.vendorId, currentUserId(request))
      );

      return reply.status(204).send();
    }
  );

  // ── 보상 지급 ───────────────────────────────────────────────
  const rewardStatusQuerySchema = z.object({ status: z.enum(['earned', 'held']).default('earned') });

  app.get('/v1/admin/rewards', auth, async (request) => {
    const query = rewardStatusQuerySchema.parse(request.query ?? {});
    return { rewards: await rewardAdmin.list(context.pool, query.status) };
  });

  const rewardDecisionBodySchema = z.object({ note: z.string().trim().min(1) });

  for (const [path, to] of [
    ['pay', 'paid'],
    ['block', 'blocked'],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/v1/admin/rewards/:id/${path}`,
      auth,
      async (request, reply) => {
        const body = rewardDecisionBodySchema.parse(request.body);

        await run(() =>
          rewardAdmin.decide(context.pool, request.params.id, to, currentUserId(request), body.note)
        );

        return reply.status(204).send();
      }
    );
  }

  // ── 회원탈퇴 운영자 개입 ─────────────────────────────────────
  app.get('/v1/admin/withdrawals', auth, async () => ({
    accounts: await withdrawalAdmin.list(context.pool),
  }));

  const holdWithdrawalBodySchema = z.object({
    reason: z.string().trim().min(1),
    until: z.iso.datetime(),
  });

  app.post<{ Params: { userId: string } }>(
    '/v1/admin/withdrawals/:userId/hold',
    auth,
    async (request, reply) => {
      const body = holdWithdrawalBodySchema.parse(request.body);

      await run(() =>
        withdrawalAdmin.hold(
          context.pool,
          request.params.userId,
          currentUserId(request),
          body.reason,
          new Date(body.until)
        )
      );

      return reply.status(204).send();
    }
  );

  /*
   * **운영자가 대신 탈퇴시킨다**(2026-09-10 대표 지시).
   *
   * 위의 셋(hold · resume · retry)은 전부 사용자가 이미 낸 탈퇴에 개입하는 것이다.
   * 시작을 대신 누르는 자리가 없어서, 운영자는 지워야 할 계정을 보고도 손이 없었다.
   *
   * 사유를 반드시 받는다. 되돌릴 수 없는 조작이고, 남이 대신 지운 계정은 본인이
   * 지운 계정과 결과가 같아서 기록이 없으면 나중에 둘을 가릴 방법이 없다.
   *
   * 주소를 `/withdrawals/` 아래가 아니라 `/users/` 아래에 둔다 — 앞의 셋은 이미
   * 탈퇴한 계정을 다루고, 이것은 **아직 탈퇴하지 않은 계정**에 대고 누른다.
   */
  const forceWithdrawBodySchema = z.object({ reason: z.string().trim().min(1) });

  app.post<{ Params: { userId: string } }>(
    '/v1/admin/users/:userId/withdraw',
    auth,
    async (request) => {
      const body = forceWithdrawBodySchema.parse(request.body);

      return await run(() =>
        withdrawalAdmin.forceWithdraw(
          { pool: context.pool, storage: context.storage },
          request.params.userId,
          currentUserId(request),
          body.reason
        )
      );
    }
  );

  const resumeWithdrawalBodySchema = z.object({ reason: z.string().trim().min(1) });

  app.post<{ Params: { userId: string } }>(
    '/v1/admin/withdrawals/:userId/resume',
    auth,
    async (request, reply) => {
      const body = resumeWithdrawalBodySchema.parse(request.body);

      await run(() =>
        withdrawalAdmin.resume(context.pool, request.params.userId, currentUserId(request), body.reason)
      );

      return reply.status(204).send();
    }
  );

  app.post<{ Params: { userId: string } }>(
    '/v1/admin/withdrawals/:userId/retry',
    auth,
    async (request) =>
      run(() =>
        withdrawalAdmin.retry(
          { pool: context.pool, storage: context.storage },
          request.params.userId,
          currentUserId(request)
        )
      )
  );

  // ── 보관 점검 ───────────────────────────────────────────────
  app.get('/v1/admin/retention/due', auth, async () => ({
    documents: await retentionWorker.listDueDocuments(context.pool),
  }));

  app.get('/v1/admin/retention/attention', auth, async () => ({
    documents: await retentionWorker.listRetentionAttention(context.pool),
  }));

  app.get('/v1/admin/retention/held', auth, async () => ({
    documents: await retentionWorker.listHeldForVerification(context.pool),
  }));

  app.get('/v1/admin/retention/failed', auth, async () => ({
    documents: await retentionWorker.listFailedDeletions(context.pool),
  }));

  app.post<{ Params: { documentId: string } }>(
    '/v1/admin/retention/:documentId/delete',
    auth,
    async (request) =>
      run(async () => {
        const outcome = await retentionWorker.deleteDocument(
          { pool: context.pool, storage: context.storage },
          request.params.documentId,
          currentUserId(request)
        );

        if (!outcome.ok) throw new Error(outcome.reason);

        return { keysDeleted: outcome.keysDeleted };
      })
  );

  app.post('/v1/admin/retention/sweep', auth, async () =>
    retentionWorker.sweepExpiredDocuments({ pool: context.pool, storage: context.storage })
  );

  app.post('/v1/admin/retention/collect-unreachable', auth, async () => ({
    moved: await retentionWorker.markUnreachableForReview(context.pool),
  }));

  // ── 광고 지면 ───────────────────────────────────────────────
  app.get('/v1/admin/ad-placements', auth, async () => ({
    placements: await adAdmin.list(context.pool),
  }));

  app.get('/v1/admin/ad-placements/firewall', auth, async () => adAdmin.firewallNotice());

  const addPlacementBodySchema = z.object({
    vendorId: z.string().trim().min(1),
    surface: z.string().trim().min(1),
    tier: z.string().trim().min(1),
    category: z.string().trim().min(1).optional(),
    region: z.string().trim().min(1).optional(),
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
  });

  app.post('/v1/admin/ad-placements', auth, async (request, reply) => {
    const body = addPlacementBodySchema.parse(request.body);
    const placementId = await run(() => adAdmin.add(context.pool, body, currentUserId(request)));

    return reply.status(201).send({ placementId });
  });

  app.delete<{ Params: { id: string } }>(
    '/v1/admin/ad-placements/:id',
    auth,
    async (request, reply) => {
      const removed = await run(() => adAdmin.remove(context.pool, request.params.id, currentUserId(request)));

      if (!removed) throw notFound('광고 자리');

      return reply.status(204).send();
    }
  );

  // ── AI 사용량과 예산 ────────────────────────────────────────
  app.get('/v1/admin/ai-budget/status', auth, async () => ({
    status: await aiCostAdmin.status(context.pool),
  }));

  const aiUsageQuerySchema = z.object({ months: z.coerce.number().int().positive().default(3) });

  app.get('/v1/admin/ai-budget/usage', auth, async (request) => {
    const query = aiUsageQuerySchema.parse(request.query ?? {});
    return { usage: await aiCostAdmin.usage(context.pool, query.months) };
  });

  const setBudgetBodySchema = z.object({ amount: z.number().positive() });

  app.post<{ Params: { feature: string } }>(
    '/v1/admin/ai-budget/:feature',
    auth,
    async (request, reply) => {
      const { feature } = request.params;
      if (!isFeature(feature)) throw new ApiError('invalid_request', '없는 기능이다.');

      const body = setBudgetBodySchema.parse(request.body);

      await run(() => aiCostAdmin.setBudget(context.pool, feature, body.amount, currentUserId(request)));

      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { feature: string } }>(
    '/v1/admin/ai-budget/:feature',
    auth,
    async (request, reply) => {
      const { feature } = request.params;
      if (!isFeature(feature)) throw new ApiError('invalid_request', '없는 기능이다.');

      await run(() => aiCostAdmin.clearBudget(context.pool, feature, currentUserId(request)));

      return reply.status(204).send();
    }
  );

  /**
   * 가격 이상치 탐지. 관리자 > 통계·이상치 화면(ADM-STATS).
   *
   * 카테고리별로 결제 금액의 평균·표준편차를 계산하고, 평균 + 3σ 초과 건을 이상치로
   * 분류한다. 건수가 적은 카테고리(n < 10)는 통계가 불안정하므로 제외한다.
   */
  app.get('/v1/admin/price-stats', auth, async () => {
    type StatsRow = {
      vendor_id: string;
      vendor_name: string;
      category: string;
      amount: string;
      mean: string;
      stddev: string;
      paid_at: Date;
    };

    const { rows } = await context.pool.query<StatsRow>(
      `WITH stats AS (
         SELECT
           p.vendor_id,
           v.name  AS vendor_name,
           v.category,
           p.paid_amount AS amount,
           p.paid_at,
           AVG(p.paid_amount)    OVER (PARTITION BY v.category) AS mean,
           STDDEV(p.paid_amount) OVER (PARTITION BY v.category) AS stddev,
           COUNT(*)              OVER (PARTITION BY v.category) AS cat_count
         FROM structured.usable_payment_proofs p
         JOIN structured.vendors v ON v.id = p.vendor_id
       )
       SELECT vendor_id, vendor_name, category, amount, mean, stddev, paid_at
       FROM stats
       WHERE cat_count >= 10
         AND stddev > 0
         AND amount > mean + 3 * stddev
       ORDER BY (amount - mean) / stddev DESC
       LIMIT 200`
    );

    const anomalies = rows.map((r) => ({
      vendorId: r.vendor_id,
      vendorName: r.vendor_name,
      category: r.category,
      amount: Number(r.amount),
      mean: Number(r.mean),
      stddev: Number(r.stddev),
      detectedAt: r.paid_at.toISOString(),
    }));

    return { total: anomalies.length, anomalies };
  });

  /**
   * 신고·VOC 접수 목록. 관리자 > 신고·VOC 화면(ADM-REPORT).
   *
   * 현재는 후기 신고만 있다. 다른 신고 유형이 생기면 UNION으로 확장한다.
   */
  app.get('/v1/admin/reports', auth, async (request) => {
    const query = (request.query as { status?: string; limit?: string; cursor?: string });
    const status = query.status ?? 'pending';
    const limit = Math.min(Number(query.limit ?? 20), 100);
    const cursor = query.cursor;

    type ReportRow = {
      id: string;
      report_type: string;
      reported_at: Date;
      status: string;
      reporter_count: string;
      summary: string | null;
    };

    const params: unknown[] = [status, limit + 1];
    let cursorClause = '';
    if (cursor) {
      cursorClause = `AND rr.received_at < $3`;
      params.push(cursor);
    }

    const { rows } = await context.pool.query<ReportRow>(
      `SELECT
         rr.id,
         'review' AS report_type,
         rr.received_at AS reported_at,
         CASE WHEN rr.decided_at IS NULL THEN 'pending' ELSE 'resolved' END AS status,
         COUNT(*) OVER (PARTITION BY rr.review_id) AS reporter_count,
         rr.reason::text AS summary
       FROM structured.review_reports rr
       WHERE (CASE WHEN rr.decided_at IS NULL THEN 'pending' ELSE 'resolved' END) = $1
       ${cursorClause}
       ORDER BY rr.received_at DESC
       LIMIT $2`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: items.map((r) => ({
        id: r.id,
        reportType: r.report_type,
        reportedAt: r.reported_at.toISOString(),
        status: r.status,
        reporterCount: Number(r.reporter_count),
        summary: r.summary ?? '',
      })),
      total: items.length,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]!.reported_at.toISOString() : null,
    };
  });

  // ─── Dashboard (WP-ADM-001) ───────────────────────────────────────────────
  /*
   * 값은 `dashboard-admin.ts`가 실제 큐에서 센다. 이 자리에 숫자를 박아두지
   * 않는다 — 그 자리들(`reviewQueue.total: 0` · `revenue.mrr: '₩0'`)이 홈을
   * 「볼 일이 없는 화면」으로 보이게 만들던 원인이었다.
   */
  app.get('/v1/admin/dashboard', auth, async () => dashboardAdmin.dashboard(context.pool));

  /*
   * 회원 추이. 대시보드의 차트가 구간을 바꿀 때마다 여기를 부른다.
   *
   * 네 구간을 한 번에 주지 않는다 — 대시보드는 열 때마다 도는 화면이고, 보지도
   * 않는 세 구간을 매번 세면 그만큼 느려진다.
   */
  app.get<{ Querystring: { bucket?: string } }>('/v1/admin/members-trend', auth, async (request) => {
    const bucket = request.query.bucket ?? 'month';

    if (!dashboardAdmin.isMemberBucket(bucket)) {
      throw new ApiError('invalid_request', '구간은 일 · 주 · 월 · 년 중 하나예요.');
    }

    return dashboardAdmin.memberTrend(context.pool, bucket);
  });

  // ─── Kill Switches ────────────────────────────────────────────────────────
  app.get('/v1/admin/kill-switches', auth, async () => {
    /*
     * 수집 스위치 조회가 실패해도 나머지는 보여준다 — 운영 DB에 0049가 아직 없을 수
     * 있고, 그때 화면 전체가 죽으면 끌 수단까지 같이 사라진다.
     */
    let importSwitches: KillSwitch[] = [];
    try {
      const { rows } = await context.pool.query<ImportSwitchRow>(
        `SELECT source_key, enabled, reason, updated_at
           FROM structured.import_switches
          ORDER BY source_key`
      );
      importSwitches = rows.map(toImportKillSwitch);
    } catch (error) {
      app.log.warn({ err: error }, 'import_switches 조회 실패 — 수집 스위치를 표시하지 못한다');
    }

    let featureSwitches: KillSwitch[] = [];
    try {
      const { rows } = await context.pool.query<KillSwitchRow>(
        `SELECT id, name, description, category, enabled, wired, updated_at, updated_by
           FROM structured.kill_switches
          ORDER BY category, id`
      );
      featureSwitches = rows.map(toFeatureKillSwitch);
    } catch (error) {
      app.log.warn({ err: error }, 'kill_switches 조회 실패 — 기능 스위치를 표시하지 못한다');
    }

    return { switches: [...featureSwitches, ...importSwitches] };
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>('/v1/admin/kill-switches/:id', auth, async (req, reply) => {
    const operatorId = currentUserId(req);

    if (req.params.id.startsWith(IMPORT_SWITCH_PREFIX)) {
      const enabled = req.body.enabled;
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: 'enabled_required' });
      }

      const key = req.params.id.slice(IMPORT_SWITCH_PREFIX.length);
      /* 누가 언제 바꿨는지 남길 자리는 이 테이블의 reason·updated_at뿐이다. */
      const reason = `${enabled ? '재개' : '중단'} — 관리자 ${operatorId ?? 'operator'}`;

      /*
       * **행이 없는 출처도 켜고 끌 수 있어야 한다**(Release Audit 1차 P1-12).
       * UPDATE만 하던 때는 `sbiz-seoul` · `sbiz-gyeonggi`가 행이 없어 404였고,
       * 그동안 `sync.ts`는 「행이 없으면 막는다」로 매주 수집을 통째로 거부했다.
       * 행이 없다는 것과 사람이 껐다는 것은 다른 상태여야 한다.
       *
       * **아무 문자열이나 만들지는 않는다.** 오타 하나가 스위치 목록에 쓰레기
       * 행을 남긴다. 만드는 것은 임포터가 아는 출처(`PUBLIC_SOURCES`)뿐이고,
       * 이미 행이 있는 옛 출처(`localdata` 등)는 UPDATE로 그대로 바뀐다.
       */
      const updated = await context.pool.query(
        `UPDATE structured.import_switches
            SET enabled = $1, reason = $2, updated_at = now()
          WHERE source_key = $3`,
        [enabled, reason, key]
      );

      if (updated.rowCount === 0) {
        if (!isKnownSourceKey(key)) return reply.status(404).send({ error: 'not_found' });

        await context.pool.query(
          `INSERT INTO structured.import_switches (source_key, enabled, reason)
           VALUES ($1, $2, $3)
           ON CONFLICT (source_key) DO UPDATE
              SET enabled = EXCLUDED.enabled, reason = EXCLUDED.reason, updated_at = now()`,
          [key, enabled, reason]
        );
      }

      return reply.status(204).send();
    }

    const enabled = req.body.enabled;
    if (typeof enabled !== 'boolean') {
      return reply.status(400).send({ error: 'enabled_required' });
    }

    const { rowCount } = await context.pool.query(
      `UPDATE structured.kill_switches
          SET enabled = $1, reason = $2, updated_at = now(), updated_by = $3
        WHERE id = $4`,
      [
        enabled,
        `${enabled ? '재개' : '중단'} — 관리자 ${operatorId ?? 'operator'}`,
        operatorId ?? 'operator',
        req.params.id,
      ]
    );
    if (!rowCount) return reply.status(404).send({ error: 'not_found' });
    return reply.status(204).send();
  });

  // ─── FAQ ──────────────────────────────────────────────────────────────────
  /*
   * FAQ — 운영자가 직접 등록·수정·삭제한다(2026-09-11 대표 지시).
   *
   * **여기 있던 다섯 라우트는 성공만 돌려주고 아무것도 하지 않았다.** GET은 빈
   * 배열 리터럴, POST는 `randomUUID()`, PATCH · PUT · DELETE는 204. 화면은 멀쩡히
   * 그려지고 저장 단추도 눌렸는데 남는 것이 없었다 — 「눌러도 아무 일이 없는 것이
   * 가장 나쁘다」의 실례다. 0230 마이그레이션의 표에 실제로 담는다.
   *
   * PATCH는 없앤다. 화면은 전체 항목을 보내므로(PUT) 부분 갱신을 쓰는 쪽이 없고,
   * 부르는 데 없는 쓰기 라우트를 성공으로 남겨두면 다음 사람이 그것을 믿는다.
   */
  app.get('/v1/admin/faq', auth, async () => faqAdmin.list(context.pool));

  app.post<{ Body: unknown }>('/v1/admin/faq', auth, async (request) =>
    faqAdmin.create(context.pool, faqAdmin.parseFaqInput(request.body), currentUserId(request))
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    '/v1/admin/faq/:id',
    auth,
    async (request, reply) => {
      await faqAdmin.update(
        context.pool,
        request.params.id,
        faqAdmin.parseFaqInput(request.body),
        currentUserId(request)
      );

      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { id: string } }>('/v1/admin/faq/:id', auth, async (request, reply) => {
    await faqAdmin.remove(context.pool, request.params.id);

    return reply.status(204).send();
  });

  // ─── Users ────────────────────────────────────────────────────────────────
  /*
   * 계정 목록. **탈퇴를 접수한 계정도 보인다** — 이 화면의 첫 번째 쓰임이
   * «탈퇴했는데 회원정보가 남았는가»를 확인하는 것이라, 탈퇴 계정을 숨기면 그
   * 질문에 답할 수 없다(2026-09-08 · 0080 트리거 버그가 그렇게 묻혔다).
   * 삭제가 끝난 계정은 행 자체가 없어 여기 없다 — 그것이 정상이다.
   *
   * 이메일·닉네임은 identity.identities에서 온다(structured.users에는 식별자만).
   * 상태는 withdrawal-admin과 같은 기준으로 센다 — 두 화면이 다른 말을 하지
   * 않게.
   */
  app.get('/v1/admin/users', auth, async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const search = (q['search'] ?? '').trim();
    const filter = q['status'];
    const cursor = q['cursor'];
    const limit = 25;

    const clauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter === 'withdrawn') clauses.push('u.deleted_at IS NOT NULL');
    else if (filter === 'active') clauses.push('u.deleted_at IS NULL');

    if (search) {
      clauses.push(
        `(u.display_name ILIKE $${idx} OR u.id::text = $${idx + 1}
          OR EXISTS (
            SELECT 1 FROM identity.identities i
            WHERE i.user_id = u.id AND (i.email ILIKE $${idx} OR i.nickname ILIKE $${idx})
          ))`
      );
      params.push(`%${search}%`, search);
      idx += 2;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows: countRows } = await context.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM structured.users u ${where}`,
      params
    );
    const total = Number(countRows[0]?.count ?? 0);

    const pageClauses = [...clauses];
    const pageParams = [...params];
    if (cursor) {
      pageClauses.push(`u.created_at < $${idx}`);
      pageParams.push(cursor);
      idx++;
    }
    pageParams.push(limit + 1);

    const { rows } = await context.pool.query<{
      id: string;
      display_name: string | null;
      activated_at: Date | null;
      created_at: Date;
      deleted_at: Date | null;
      is_operator: boolean;
      pick_verified: boolean;
      provider: string | null;
      email: string | null;
      nickname: string | null;
      last_login_at: Date | null;
      withdrawal_status: string | null;
      failure_message: string | null;
      failure_attempts: number | null;
    }>(
      `SELECT
         u.id, u.display_name, u.activated_at, u.created_at, u.deleted_at, u.is_operator,
         EXISTS (
           SELECT 1 FROM structured.usable_payment_proofs p WHERE p.reporter_user_id = u.id
         ) AS pick_verified,
         i.provider::text AS provider, i.email, i.nickname, i.last_login_at,
         CASE
           WHEN u.deleted_at IS NULL THEN NULL
           WHEN EXISTS (
             SELECT 1 FROM structured.withdrawal_holds h
             WHERE h.user_id = u.id AND h.resolved_at IS NULL AND h.hold_until > now()
           ) THEN 'hold'
           WHEN f.user_id IS NOT NULL THEN 'failed'
           WHEN EXISTS (
             SELECT 1 FROM originals.raw_documents d
             WHERE d.owner_user_id = u.id AND d.status <> 'deleted'
           ) THEN 'pending'
           ELSE 'deletion_pending'
         END AS withdrawal_status,
         f.error_message AS failure_message,
         f.attempt_count AS failure_attempts
       FROM structured.users u
       LEFT JOIN LATERAL (
         SELECT provider, email, nickname, last_login_at
         FROM identity.identities
         WHERE user_id = u.id
         ORDER BY last_login_at DESC
         LIMIT 1
       ) i ON true
       LEFT JOIN structured.withdrawal_deletion_failures f ON f.user_id = u.id
       ${pageClauses.length > 0 ? `WHERE ${pageClauses.join(' AND ')}` : ''}
       ORDER BY u.created_at DESC
       LIMIT $${idx}`,
      pageParams
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      users: items.map((r) => ({
        id: r.id,
        displayName: r.display_name ?? '',
        provider: r.provider,
        email: r.email,
        nickname: r.nickname,
        createdAt: r.created_at.toISOString(),
        activatedAt: r.activated_at?.toISOString() ?? null,
        lastLoginAt: r.last_login_at?.toISOString() ?? null,
        deletedAt: r.deleted_at?.toISOString() ?? null,
        isOperator: r.is_operator,
        pickVerified: r.pick_verified,
        withdrawal: r.withdrawal_status
          ? {
              status: r.withdrawal_status,
              failure: r.failure_message
                ? { message: r.failure_message, attemptCount: r.failure_attempts ?? 1 }
                : null,
            }
          : null,
      })),
      total,
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]!.created_at.toISOString() : null,
    };
  });

  // ─── Vendors ──────────────────────────────────────────────────────────────
  /*
   * WP-ADM-014가 읽는 모양으로 돌려준다. 예전에는 커서 페이지네이션에
   * `{items, hasMore, nextCursor}`를 내보냈는데 화면은 `{vendors, total}`을 읽고
   * 있었다 — 즉 표가 언제나 비어 있었다. 조회조차 되지 않고 있었던 셈이다.
   */
  app.get('/v1/admin/vendors', auth, async () => vendorAdmin.listVendors(context.pool));

  /*
   * 병합하면 무엇이 몇 건 옮겨 가는지 세어서 돌려준다. 아무것도 바꾸지 않는다.
   *
   * 병합은 이 콘솔에서 되돌릴 수 없는 유일한 조작이고 사용자가 쓴 기록에 닿는다.
   * v3.27 관리자 공통 규칙 — 위험한 조작은 무엇이 바뀌는지 항목으로 보여준 뒤
   * 한 번 더 확인. 화면은 이 응답을 확인창에 그대로 그린다.
   */
  app.get<{ Params: { id: string }; Querystring: { targetId?: string } }>(
    '/v1/admin/vendors/:id/merge-preview',
    auth,
    async (request) => {
      const targetId = request.query.targetId?.trim();
      if (!targetId) {
        throw new ApiError('invalid_request', '병합할 업체 ID를 입력해 주세요.');
      }
      return vendorAdmin.mergePreview(context.pool, request.params.id, targetId);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/v1/admin/vendors/:id/merge',
    auth,
    async (request) => {
      const body = z
        .object({ targetId: z.string().min(1), reason: z.string().min(1) })
        .safeParse(request.body);
      if (!body.success) {
        // 사유 없이 병합할 수 없다. 되돌릴 수 없는 조작에서 「왜」가 빠지면
        // 나중에 잘못을 찾아도 어디서부터 잘못됐는지 짚을 수가 없다.
        throw new ApiError('invalid_request', '병합할 업체와 사유를 입력해 주세요.');
      }
      return vendorAdmin.mergeVendors(
        context.pool,
        request.params.id,
        body.data.targetId.trim(),
        body.data.reason,
        currentUserId(request)
      );
    }
  );

  app.patch<{ Params: { id: string } }>('/v1/admin/vendors/:id/name', auth, async (request) => {
    const body = z.object({ name: z.string() }).safeParse(request.body);
    if (!body.success) {
      throw new ApiError('invalid_request', '상호를 입력해 주세요.');
    }
    return vendorAdmin.renameVendor(
      context.pool,
      request.params.id,
      body.data.name,
      currentUserId(request)
    );
  });

  app.patch<{ Params: { id: string } }>('/v1/admin/vendors/:id/status', auth, async (request) => {
    const body = z
      .object({ status: z.enum(vendorAdmin.SETTABLE_STATUSES) })
      .safeParse(request.body);
    if (!body.success) {
      // 「병합됨」은 병합의 결과이지 고르는 상태가 아니다. 고를 수 있게 두면
      // 옮겨 간 것 없이 상태만 병합됨인 업체가 생긴다.
      throw new ApiError('invalid_request', '영업 상태는 영업중 · 폐업 · 정지 중에서 고릅니다.');
    }
    return vendorAdmin.setVendorStatus(
      context.pool,
      request.params.id,
      body.data.status,
      currentUserId(request)
    );
  });

  // ─── Revenue ──────────────────────────────────────────────────────────────
  app.get('/v1/admin/revenue', auth, async () => {
    return {
      mrr: 0,
      arr: 0,
      activeSubscriptions: 0,
      churnRate: 0,
      planBreakdown: [] as { plan: string; count: number; revenue: number }[],
    };
  });

  // ─── Ads ──────────────────────────────────────────────────────────────────
  app.get('/v1/admin/ads', auth, async () => adminOps.adPlacements(context.pool));
  app.post('/v1/admin/ads', auth, async () => {
    return { id: randomUUID() };
  });
  app.patch<{ Params: { id: string } }>('/v1/admin/ads/:id', auth, async (_req, reply) => {
    return reply.status(204).send();
  });
  app.delete<{ Params: { id: string } }>('/v1/admin/ads/:id', auth, async (_req, reply) => {
    return reply.status(204).send();
  });

  /*
   * 집행 정지·재개. 화면(`ads.tsx`)이 PATCH로 `{ status }`를 보낸다 — POST가
   * 아니다. 서버 편한 모양으로 고치지 않고 부르는 대로 받는다.
   */
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/v1/admin/ads/:id/status',
    auth,
    async (request, reply) => {
      const body = adStatusBody.parse(request.body ?? {});
      await run(() =>
        adminOps.setAdStatus(
          context.pool,
          request.params.id,
          body.status,
          currentUserId(request),
          body.reason
        )
      );
      return reply.status(204).send();
    }
  );

  // ─── Ads Gate ─────────────────────────────────────────────────────────────
  app.get('/v1/admin/ads-gate', auth, async () => adminOps.adsGate(context.pool));
  app.patch('/v1/admin/ads-gate', auth, async (_req, reply) => {
    return reply.status(204).send();
  });

  /*
   * 실운영 전환 승인.
   *
   * **승인이 전환은 아니다.** `ads.production_gate.activated`는 기본값이 꺼짐이고
   * 이 판에 그것을 켜는 길이 없다 — 광고 실운영 전환은 대표 오더 대기 상태다
   * (`CLAUDE.md` 「진행 상태」). 응답이 그 사실을 그대로 말한다.
   */
  app.post<{ Body: unknown }>('/v1/admin/ads-gate/approve', auth, async (request) => {
    const body = reasonBody.parse(request.body ?? {});
    return run(() => adminOps.approveAdsGate(context.pool, currentUserId(request), body.reason));
  });

  /*
   * 실운영 전환을 켜고 끈다 — 2026-09-11 대표 지시(「광고도 진행해. 단, 관리자에서
   * 내가 컨트롤할 수 있어야 한다」).
   *
   * **입구가 여기 하나뿐이다.** 관리자 로그인을 지난 사람만 부를 수 있고
   * (`auth`), 표의 `decided_by`·`activation_follows_approval`이 그 뒤를 받친다.
   * 자동화·배치·스케줄러가 이 경로를 부르는 자리를 만들지 않는다.
   */
  app.post<{ Body: unknown }>('/v1/admin/ads-gate/activate', auth, async (request) => {
    const body = reasonBody.parse(request.body ?? {});
    return run(() => adminOps.activateAdsGate(context.pool, currentUserId(request), body.reason));
  });

  app.post<{ Body: unknown }>('/v1/admin/ads-gate/deactivate', auth, async (request) => {
    const body = reasonBody.parse(request.body ?? {});
    return run(() => adminOps.deactivateAdsGate(context.pool, currentUserId(request), body.reason));
  });

  // ─── 광고 상품(등급)별 실운영 상태 ────────────────────────────────────────
  /*
   * 검색 화면이 실제로 보는 스위치다. 전체 관문이 열려 있어도 등급이 test면 그
   * 등급의 광고는 안 나간다(`ads.tier_state`).
   */
  app.get('/v1/admin/ad-tiers', auth, async () => ({
    tiers: await adminOps.adTierStates(context.pool),
  }));

  const adTierBody = z.object({
    /** test는 받지 않는다 — 시작 상태이지 결정이 아니다. 되돌리려면 DELETE. */
    state: z.enum(['live', 'withheld', 'retired']),
    note: z.string().trim().min(1).optional(),
  });

  app.put<{ Params: { tier: string }; Body: unknown }>(
    '/v1/admin/ad-tiers/:tier',
    auth,
    async (request) => {
      const body = adTierBody.parse(request.body ?? {});

      return {
        tiers: await run(() =>
          adminOps.decideAdTier(
            context.pool,
            { tier: request.params.tier, state: body.state, note: body.note },
            currentUserId(request)
          )
        ),
      };
    }
  );

  app.delete<{ Params: { tier: string } }>(
    '/v1/admin/ad-tiers/:tier',
    auth,
    async (request) => ({
      tiers: await run(() =>
        adminOps.clearAdTierDecision(context.pool, request.params.tier, currentUserId(request))
      ),
    })
  );

  // ─── AI Usage ─────────────────────────────────────────────────────────────
  app.get('/v1/admin/ai-usage', auth, async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const months = Number(q['months'] ?? '3');
    const [usage, budgetStatus] = await Promise.all([
      aiCostAdmin.usage(context.pool, months),
      aiCostAdmin.status(context.pool),
    ]);
    return { usage, budgetStatus };
  });

  // ─── Automation ───────────────────────────────────────────────────────────
  app.get('/v1/admin/automation', auth, async () => adminOps.automationStatus(context.pool));
  app.patch('/v1/admin/automation', auth, async (_req, reply) => {
    return reply.status(204).send();
  });

  /** 실패한 줄을 다시 대기 목록에 세운다. 지우지 않는다. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/admin/automation/:id/recover',
    auth,
    async (request) => {
      const body = reasonBody.parse(request.body ?? {});
      return run(() =>
        adminOps.recoverWorkflow(context.pool, request.params.id, currentUserId(request), body.reason)
      );
    }
  );

  /** DLQ를 «확인했다»로 표시한다. 실패 기록 자체는 남는다. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/admin/automation/:id/drain-dlq',
    auth,
    async (request) => {
      const body = reasonBody.parse(request.body ?? {});
      return run(() =>
        adminOps.drainDlq(context.pool, request.params.id, currentUserId(request), body.reason)
      );
    }
  );

  // ─── Biz Queue ────────────────────────────────────────────────────────────
  app.get('/v1/admin/biz-queue', auth, async () => {
    return { items: [] as unknown[], total: 0 };
  });

  // ─── Briefing ─────────────────────────────────────────────────────────────
  app.get('/v1/admin/briefing', auth, async () => {
    const [briefing, budgetStatus] = await Promise.all([
      decisionsAdmin.briefing(context.pool),
      aiCostAdmin.status(context.pool),
    ]);
    return { briefing, budgetStatus };
  });

  // ─── Campaigns ────────────────────────────────────────────────────────────
  app.get('/v1/admin/campaigns', auth, async () => adminOps.campaignGrants(context.pool));
  app.post('/v1/admin/campaigns', auth, async () => {
    return { id: randomUUID() };
  });

  /*
   * 지급 · 차단.
   *
   * 판단 로직을 새로 쓰지 않는다 — `reward-admin`의 `decide`가 이미 「받는 본인은
   * 지급할 수 없다」 · 「이미 처리된 건은 다시 처리하지 않는다」 · 감사 기록 ·
   * 알림까지 한 트랜잭션에서 한다. 여기서는 화면의 말(`pay`/`block`)을 그 함수의
   * 말로 옮길 뿐이다.
   */
  app.post<{ Params: { id: string; action: string }; Body: unknown }>(
    '/v1/admin/campaigns/:id/:action',
    auth,
    async (request, reply) => {
      const { action } = request.params;

      if (action !== 'pay' && action !== 'block') {
        throw new ApiError('invalid_request', '지급 또는 차단만 할 수 있습니다.');
      }

      const body = reasonBody.parse(request.body ?? {});

      await run(() =>
        rewardAdmin.decide(
          context.pool,
          request.params.id,
          action === 'pay' ? 'paid' : 'blocked',
          currentUserId(request),
          body.reason ?? '관리자 콘솔에서 처리'
        )
      );

      return reply.status(204).send();
    }
  );

  // ─── Data / Pipeline ──────────────────────────────────────────────────────
  /*
   * 바탕은 `structured.analyses`다. 예전에는 `{stages: [], lastRunAt: null}`이라는
   * 빈 껍데기를 돌려줬는데, 화면은 `today` · `stages` · `failedQueue` 셋을 읽으므로
   * `data.today.received`에서 터졌다 — 화면이 아예 뜨지 않았다.
   */
  app.get('/v1/admin/data/pipeline', auth, async () => dataPipeline.pipelineData(context.pool));

  app.post<{ Params: { id: string } }>(
    '/v1/admin/data/pipeline/retry/:id',
    auth,
    async (request, reply) => {
      await dataPipeline.retryAnalysis(context.pool, request.params.id);
      return reply.status(204).send();
    }
  );

  app.post('/v1/admin/data/pipeline/retry-all', auth, async () =>
    dataPipeline.retryAllFailed(context.pool)
  );

  // ─── Data / Email Matching ────────────────────────────────────────────────
  /*
   * **여기에는 아직 아무 상태도 없다.** 업체 회신 메일을 받아 두는 표가 DB에 없고
   * (0001~0121 어디에도 없다), 파싱도 매칭도 도는 곳이 없다. 그래서 「반영」·「재시도」는
   * 만들지 않았다 — 서버에 그 상태가 없으면 단추도 두지 않는다. 화면의 잠금은
   * 그대로 두고, 무엇이 없어서 잠겨 있는지는 PR에 적었다.
   *
   * 다만 `summary`는 채워서 내보낸다. 예전에는 `{items, total}`만 줬는데 화면은
   * `data.summary[s]`를 읽으므로 undefined를 인덱싱하다 화면이 통째로 죽었다 —
   * 「빈 상태」가 아니라 흰 화면이었다. 0으로 채우면 v3.27의 「빈 상태가 정상 상태」가
   * 그려진다.
   */
  app.get('/v1/admin/data/email-matching', auth, async () => {
    return {
      summary: { total: 0, matched: 0, unmatched: 0, applied: 0, failed: 0 },
      items: [] as unknown[],
    };
  });

  // ─── Data / Images ────────────────────────────────────────────────────────
  /*
   * WP-ADM-015가 읽는 모양으로 돌려준다.
   *
   * 예전에는 `{items, hasMore, nextCursor}`에 `copyrightBasis` · `status`를 따로
   * 담아 내보냈다. 화면은 `data.summary.total`과 `item.rightsStatus`를 읽으므로
   * summary에서 곧바로 죽었다. **권리와 처리 상태를 한 값으로 합친다** — 화면이
   * 보는 것은 「이 사진을 내보낼 수 있나」 하나이고, 폐기됐으면 권리가 무엇이든
   * 못 내보낸다.
   */
  app.get('/v1/admin/data/images', auth, async () => {
    const { rows } = await context.pool.query<{
      id: string;
      vendor_name: string;
      source_url: string | null;
      copyright_basis: string;
      match_confidence: string | null;
      status: string;
      created_at: Date;
    }>(
      `SELECT vi.id, v.name AS vendor_name, vi.source_url,
              vi.copyright_basis, vi.match_confidence::text,
              vi.status, vi.created_at
         FROM structured.vendor_images vi
         JOIN structured.vendors v ON v.id = vi.vendor_id
        ORDER BY vi.created_at DESC
        LIMIT 200`
    );

    const items = rows.map((r) => ({
      id: r.id,
      vendorName: r.vendor_name,
      // 출처는 사람이 눈으로 확인하는 자리라 도메인만으로 줄이지 않는다.
      source: r.source_url ?? '출처 없음',
      // 거부 상태 넷은 화면에서 전부 「폐기됨」 하나로 보인다 — 왜 뺐는지는
      // 운영 기록의 몫이고, 이 표가 답하는 질문은 「내보낼 수 있나」다.
      rightsStatus: r.status.endsWith('_rejected') || r.status === 'crop_failed'
        ? ('rejected' as const)
        : mapCopyrightBasis(r.copyright_basis),
      matchConfidence: r.match_confidence !== null ? Number(r.match_confidence) : 0,
      createdAt: r.created_at.toISOString(),
      url: r.source_url ?? null,
    }));

    return {
      summary: {
        total: items.length,
        licensed: items.filter(
          (i) => i.rightsStatus !== 'pending' && i.rightsStatus !== 'rejected'
        ).length,
        pending: items.filter((i) => i.rightsStatus === 'pending').length,
        rejected: items.filter((i) => i.rightsStatus === 'rejected').length,
      },
      items,
    };
  });

  /*
   * 화면(WP-ADM-015)이 POST로 부른다. 서버는 PATCH로 열려 있었다 — 라우트는 있는데
   * 메서드가 어긋나 404가 나던 자리다. 이 콘솔 말고 부르는 곳이 없으므로 화면에
   * 맞춘다.
   *
   * 없는 이미지를 승인해도 조용히 204가 나가던 것도 같이 고친다. 운영자에게는
   * 「승인됐다」로 보이는데 아무 일도 안 일어난 상태였다.
   */
  /**
   * 승인 · 폐기.
   *
   * 폐기에는 **이유를 반드시 적는다** — 0050의 `image_rejection_has_reason`이
   * 거부 상태에 이유 없이 들어가는 것을 막는다. 예전 라우트는 이유 없이
   * `quality_rejected`를 넣어서, 폐기를 누를 때마다 CHECK에 걸려 500이 났다.
   *
   * 상태도 `rights_rejected`로 바로잡는다. 화면(WP-ADM-015)이 폐기 단추를 내놓는
   * 것은 **권리가 확인되지 않은** 사진이지 화질이 나쁜 사진이 아니다.
   */
  async function setImageStatus(id: string, decision: 'approve' | 'reject') {
    // uuid가 아닌 것을 넣으면 Postgres가 22P02로 터져 500이 된다. 실제로는 ID가
    // 잘못된 것이므로 404로 답한다.
    if (!UUID_RE.test(id)) throw notFound('이미지');

    const { rowCount } =
      decision === 'approve'
        ? await context.pool.query(
            `UPDATE structured.vendor_images
                SET status = 'approved', rejection_reason = NULL, verified_at = now()
              WHERE id = $1`,
            [id]
          )
        : await context.pool.query(
            `UPDATE structured.vendor_images
                SET status = 'rights_rejected',
                    rejection_reason = '운영자 폐기 — 권리 미확인',
                    is_representative = false,
                    verified_at = now()
              WHERE id = $1`,
            [id]
          );

    if (rowCount === 0) throw notFound('이미지');
  }

  app.post<{ Params: { id: string } }>(
    '/v1/admin/data/images/:id/approve',
    auth,
    async (request, reply) => {
      await setImageStatus(request.params.id, 'approve');
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    '/v1/admin/data/images/:id/reject',
    auth,
    async (request, reply) => {
      await setImageStatus(request.params.id, 'reject');
      return reply.status(204).send();
    }
  );

  // ─── Marketing ────────────────────────────────────────────────────────────
  app.get('/v1/admin/marketing', auth, async () => {
    try {
      const [items, summary] = await Promise.all([
        marketingStore.listJobs(context.pool, 50),
        marketingStore.getSummary(context.pool),
      ]);
      return { summary, items };
    } catch {
      // DB 없을 때 빈 응답 (개발 환경)
      return {
        summary: { generated: 0, simulated: 0, failed: 0, failRate: 0 },
        items: [],
      };
    }
  });

  app.post('/v1/admin/marketing/sources', auth, async (request) => {
    const body = request.body as {
      id: string; factIds: string[]; reviewed?: boolean;
      expiresAt?: string; nextVerifyAt?: string; note?: string;
    };
    await marketingStore.registerSource(context.pool, {
      id: body.id,
      factIds: body.factIds,
      reviewed: body.reviewed ?? false,
      reviewedAt: body.reviewed ? new Date().toISOString() : null,
      expiresAt: body.expiresAt ?? null,
      nextVerifyAt: body.nextVerifyAt ?? null,
      active: true,
      note: body.note,
    });
    return { ok: true };
  });

  app.delete<{ Params: { sourceId: string } }>(
    '/v1/admin/marketing/sources/:sourceId',
    auth,
    async (request) => {
      const { sourceId } = request.params;
      await marketingStore.deactivateSource(context.pool, sourceId);
      return { ok: true };
    },
  );

  app.post('/v1/admin/marketing/generate', auth, async (request, reply) => {
    const body = request.body as {
      sourceId: string; channel: string; format: string; scheduledAt?: string;
    };
    const source = await marketingStore.getSource(context.pool, body.sourceId);
    if (!source) return reply.status(404).send({ error: '소재를 찾을 수 없습니다.' });

    const jobKey = `job_${Date.now()}`;
    const result = marketingContent.generateContent(
      source,
      body.channel as MarketingChannel,
      body.format as MarketingFormat,
      jobKey,
    );
    if (!result.ok) return reply.status(400).send({ error: result.error });

    const job = await marketingStore.createJob(context.pool, {
      sourceId: body.sourceId,
      channel: body.channel as MarketingChannel,
      format: body.format as MarketingFormat,
      title: result.title,
      body: result.body,
      utmUrl: result.utmUrl,
      scheduledAt: body.scheduledAt,
    });
    return { job };
  });

  app.post<{ Params: { jobId: string } }>(
    '/v1/admin/marketing/:jobId/simulate',
    auth,
    async (_request) => {
      const r = await marketingStore.processScheduled(context.pool);
      return { ok: true, result: r };
    },
  );

  app.post<{ Params: { jobId: string } }>(
    '/v1/admin/marketing/:jobId/retry',
    auth,
    async (request) => {
      const { jobId } = request.params;
      await marketingStore.retryJob(context.pool, jobId);
      return { ok: true };
    },
  );

  app.get<{ Params: { jobId: string } }>(
    '/v1/admin/marketing/:jobId/events',
    auth,
    async (request) => {
      const { jobId } = request.params;
      const jobEvents = await marketingStore.listJobEvents(context.pool, jobId);
      return { events: jobEvents };
    },
  );

  app.get('/v1/admin/marketing/plan-prompt', auth, async (request, reply) => {
    const { sourceId, channel, format } = request.query as {
      sourceId?: string; channel?: string; format?: string;
    };
    if (!sourceId || !channel || !format) {
      return reply.status(400).send({ error: 'sourceId, channel, format 필수' });
    }
    const source = await marketingStore.getSource(context.pool, sourceId);
    if (!source) return reply.status(404).send({ error: '소재 없음' });
    const result = marketingContent.generateContent(
      source,
      channel as MarketingChannel,
      format as MarketingFormat,
      'prompt_preview',
    );
    if (!result.ok) return reply.status(400).send({ error: result.error });
    return { prompt: result.planningPrompt };
  });

  // ─── Policy Engine ────────────────────────────────────────────────────────
  app.get('/v1/admin/policy-engine', auth, async () => adminOps.policyRules(context.pool));

  /*
   * 기준값을 고친다. 화면(`policy-engine.tsx`)이 고친 줄을 모아 **한 번에** 보낸다 —
   * `PATCH /v1/admin/policy-engine` 에 `{ changes: [{ key, value }, …] }`.
   *
   * 줄마다 부르지 않는 이유가 화면 쪽에 있다: 여러 값을 같이 보고 고친 뒤 «변경 사항
   * 저장» 하나로 끝낸다. 서버도 한 트랜잭션으로 받아야 중간에 하나가 실패했을 때
   * 앞의 것만 남는 상태가 생기지 않는다.
   *
   * 고칠 때마다 되돌릴 자리를 하나 만든다 — 되돌리는 길이 없으면 고치기 전에
   * 손이 멈추고, 그러면 이 화면이 있을 이유가 없다.
   */
  app.patch<{ Body: unknown }>('/v1/admin/policy-engine', auth, async (request, reply) => {
    const body = policyChangesBody.parse(request.body ?? {});
    await run(() => adminOps.setPolicyRules(context.pool, body.changes, currentUserId(request)));
    return reply.status(204).send();
  });

  // ─── Rollback ─────────────────────────────────────────────────────────────
  app.get('/v1/admin/rollback', auth, async () => adminOps.rollbackTargets(context.pool));

  /** 첫 단계. 승인만 한다 — 여기서 되돌아가는 것은 없다. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/admin/rollback/:id/approve',
    auth,
    async (request, reply) => {
      const body = reasonBody.parse(request.body ?? {});
      await run(() =>
        adminOps.approveRollback(context.pool, request.params.id, currentUserId(request), body.reason)
      );
      return reply.status(204).send();
    }
  );

  /*
   * 둘째 단계. **승인된 것만 실행한다.**
   *
   * 한 번에 도는 길을 만들지 않는다. 여기서 막고, 0130의 `trigger_follows_approval`이
   * 한 번 더 막는다 — 롤백 실행은 사용자 화면이 바로 바뀌는 조작이다.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/admin/rollback/:id/trigger',
    auth,
    async (request) => {
      const body = reasonBody.parse(request.body ?? {});
      return run(() =>
        adminOps.triggerRollback(context.pool, request.params.id, currentUserId(request), body.reason)
      );
    }
  );

  // ─── Terms ────────────────────────────────────────────────────────────────
  app.get('/v1/admin/terms', auth, async () => adminOps.termsDocuments(context.pool));
  /*
   * 막힌 자리는 **무엇이 되는지**를 말한다(v3.27). 「~할 수 없어요」로 끝나면
   * 운영자는 다음에 무엇을 해야 하는지 모른 채 화면을 닫는다.
   */
  const termsUnavailable = async () => {
    throw new ApiError(
      'invalid_request',
      '지금은 약관 조문과 판 이력을 조회할 수 있어요. 편집·공개는 앱 약관·동의 기록에 연결한 뒤 열려요.'
    );
  };
  app.post('/v1/admin/terms', auth, termsUnavailable);

  /** 조문 편집. 화면(`terms.tsx`)이 PUT으로 `{ body }`를 보낸다. */
  app.put<{ Params: { id: string; clauseId: string }; Body: unknown }>(
    '/v1/admin/terms/:id/clauses/:clauseId',
    auth,
    async (request) => {
      const doc = request.params.id;

      if (!adminOps.isDocType(doc)) throw notFound('문서');
      return termsUnavailable();
    }
  );

  /** 초안 공개. 공개한 판은 얼어붙고, 이어서 고칠 새 초안이 같이 생긴다. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/admin/terms/:id/publish',
    auth,
    async (request) => {
      const doc = request.params.id;

      if (!adminOps.isDocType(doc)) throw notFound('문서');

      return termsUnavailable();
    }
  );

  /*
   * ─── Audit Log ────────────────────────────────────────────────────────────
   *
   * 화면(`audit-log.tsx`)은 `?q=`로 검색어를 보내고 `{ items, total, hasMore, cursor }`를
   * 읽는다. 예전 서버는 `?workflow=`·`?cursor=`를 읽고 `nextCursor`를 돌려줬다 —
   * 주소는 같은데 **어느 쪽도 서로를 만나지 못했다.** 화면 쪽으로 맞춘다.
   */
  app.get('/v1/admin/audit-log', auth, async (request) => {
    const q = request.query as Record<string, string | undefined>;
    return adminOps.auditLog(context.pool, { q: q['q'], cursor: q['cursor'] });
  });

  // ─── Data / Price Stats (WP-ADM-PRICE) ────────────────────────────────────
  /*
   * 화면이 쓰는 «단계» 숫자와 도메인 단계 이름을 잇는 자리. **사다리를 다시 쓰지
   * 않는다** — 여기에 `count >= 3 ? … : …`를 한 번 더 적으면 도메인의 3·5·10이
   * 바뀐 날 관리자 통계만 옛 기준으로 남고, 화면은 그것을 성공이라 말한다.
   */
  const STAGE_NUMBER: Record<DisclosureStage, 0 | 1 | 2 | 3> = {
    collecting: 0,
    limited: 1,
    normal: 2,
    detailed: 3,
  };

  app.get('/v1/admin/data/price-stats', auth, async () => {
    type StatRow = {
      vendor_id: string;
      vendor_name: string;
      data_count: string;
      anomaly_count: string;
    };
    const { rows } = await context.pool.query<StatRow>(
      `SELECT
         p.vendor_id,
         v.name AS vendor_name,
         COUNT(*) AS data_count,
         SUM(CASE WHEN p.paid_amount > stats.mean + 3 * stats.stddev THEN 1 ELSE 0 END) AS anomaly_count
       FROM structured.usable_payment_proofs p
       JOIN structured.vendors v ON v.id = p.vendor_id
       JOIN LATERAL (
         SELECT AVG(paid_amount) AS mean, STDDEV(paid_amount) AS stddev
         FROM structured.usable_payment_proofs
         WHERE vendor_id = p.vendor_id
       ) stats ON true
       GROUP BY p.vendor_id, v.name
       ORDER BY data_count DESC
       LIMIT 200`
    );

    const vendors = rows.map((r) => {
      const count = Number(r.data_count);
      const stage = STAGE_NUMBER[disclosureStage(count)];
      return {
        vendorId: r.vendor_id,
        vendorName: r.vendor_name,
        dataCount: count,
        publicStage: stage,
        anomalyCandidates: Number(r.anomaly_count),
        statsVersion: '1',
        lastRecalcAt: new Date().toISOString(),
      };
    });

    const summary = {
      totalVendors: vendors.length,
      stage0: vendors.filter((v) => v.publicStage === 0).length,
      stage1: vendors.filter((v) => v.publicStage === 1).length,
      stage2: vendors.filter((v) => v.publicStage === 2).length,
      stage3plus: vendors.filter((v) => v.publicStage === 3).length,
    };

    return { summary, vendors };
  });

  app.post<{ Params: { vendorId: string } }>('/v1/admin/data/price-stats/:vendorId/recalc', auth, async (_req, reply) => {
    return reply.status(202).send({ queued: true });
  });
}
