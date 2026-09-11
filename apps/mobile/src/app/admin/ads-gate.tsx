/**
 * WP-ADM-034 성장 · 광고 실운영 전환 게이트
 * 테스트 전체 오픈 → 데이터 축적 → AI 독립 분석 → 보고서 → 최종 결정 → 실운영
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, FontSize, LineHeight, Spacing } from '@weddingpick/ui';
import { DelayedLoader } from '@/features/loading/delayed-loader';
import { apiFetch } from './_api';
import { formatDateDot } from '@/features/common/format-date';
import { ConfirmCard } from './_ui';

type GateStepStatus = 'done' | 'in_progress' | 'pending' | 'blocked';

type GateStep = {
  id: string;
  label: string;
  description: string;
  status: GateStepStatus;
  completedAt: string | null;
  detail: string | null;
  requiresAction: boolean;
};

type AdsGateData = {
  currentPhase: number;
  steps: GateStep[];
  readyForProduction: boolean;
  /** 지금 광고가 나가는가. */
  activated: boolean;
  /** 승인은 끝났는데 아직 안 켠 상태. */
  canActivate: boolean;
  blockers: string[];
};

/**
 * 광고 상품(등급)별 상태. **검색 화면이 실제로 보는 스위치가 이것이다** —
 * 전체 관문이 열려 있어도 등급이 «테스트»면 그 등급의 광고는 안 나간다.
 */
type TierState = 'test' | 'live' | 'withheld' | 'retired';
type AdTier = {
  tier: string;
  state: TierState;
  decidedAt: string | null;
  placements: number;
};

const TIER_LABEL: Record<string, string> = {
  light: '라이트',
  standard: '스탠다드',
  premium: '프리미엄',
};

const TIER_STATE_LABEL: Record<TierState, string> = {
  test: '테스트 — 화면에 안 나감',
  live: '실운영 — 화면에 나감',
  withheld: '보류 — 화면에 안 나감',
  retired: '종료 — 화면에 안 나감',
};

const TIER_STATE_COLOR: Record<TierState, string> = {
  test: Colors.light.textAssistive,
  live: Colors.light.positive,
  withheld: Colors.light.cautionary,
  retired: Colors.light.textAssistive,
};

/** 확인창이 하나라 무엇을 묻는 중인지 들고 있어야 한다. */
type Asking =
  | { kind: 'approve' }
  | { kind: 'activate' }
  | { kind: 'deactivate' }
  | { kind: 'tier'; tier: string; state: TierState };

const STEP_COLOR: Record<GateStepStatus, string> = {
  done: Colors.light.positive,
  in_progress: Colors.light.accent,
  pending: Colors.light.textAssistive,
  blocked: Colors.light.negative,
};
const STEP_LABEL: Record<GateStepStatus, string> = {
  done: '완료',
  in_progress: '진행 중',
  pending: '대기',
  blocked: '차단됨',
};

export default function AdsGateScreen() {
  const [data, setData] = useState<AdsGateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [confirming, setConfirming] = useState(false);
  /** 확인창을 띄운 상태. 누르는 것과 확정하는 것을 나눈다(v3.27). */
  const [asking, setAsking] = useState<Asking | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<AdTier[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    /*
     * 관문과 등급을 함께 읽는다. 둘이 다른 스위치라 하나만 보면 «승인은 됐는데
     * 왜 광고가 안 나가지»가 된다 — 등급이 테스트면 관문과 무관하게 안 나간다.
     */
    Promise.all([apiFetch('/v1/admin/ads-gate'), apiFetch('/v1/admin/ad-tiers')])
      .then(([gate, tierList]) => {
        if (cancelled) return;
        setData(gate as AdsGateData);
        setTiers((tierList as { tiers: AdTier[] }).tiers);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '불러오기 실패');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [rev]);

  /**
   * 확인창에서 «예»를 받은 뒤 실제로 부르는 자리. 무엇을 묻고 있었는지에 따라
   * 주소가 갈린다.
   *
   * **되돌리는 길을 함께 둔다.** 켜기만 있고 끄기가 없으면 그것은 컨트롤이
   * 아니다 — 되돌릴 수 없는 단추는 누르기 전에 망설이게 만든다.
   */
  async function confirmAsked(what: Asking) {
    setConfirming(true);
    try {
      if (what.kind === 'tier') {
        await (what.state === 'test'
          ? apiFetch(`/v1/admin/ad-tiers/${what.tier}`, { method: 'DELETE' })
          : apiFetch(`/v1/admin/ad-tiers/${what.tier}`, {
              method: 'PUT',
              body: JSON.stringify({ state: what.state }),
            }));
      } else {
        await apiFetch(`/v1/admin/ads-gate/${what.kind}`, { method: 'POST' });
      }

      setActionError(null);
      setRev((r) => r + 1);
    } catch (e: unknown) {
      // 삼키지 않는다. 눌렀는데 아무 일도 없는 것처럼 보이는 것이 가장 나쁘다.
      setActionError(e instanceof Error ? e.message : '요청 실패');
    } finally {
      setConfirming(false);
      // 실패해도 닫는다 — 창이 떠 있으면 오류 문구가 창에 가린다.
      setAsking(null);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>광고 전환 승인</Text>
        <Pressable style={styles.refreshBtn} onPress={() => setRev((r) => r + 1)}>
          <Text style={styles.refreshText}>새로 고침</Text>
        </Pressable>
      </View>

      <DelayedLoader active={loading} size={40} style={styles.centered} />
      {!loading && error && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => setRev((r) => r + 1)}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && data && (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {/* 현재 상태 */}
          {/*
            **지금 봐야 할 것이 맨 위다**(v3.27). 이 화면에서 그것은 단계 번호가
            아니라 «광고가 지금 나가는가»다 — 그것 하나 때문에 여기 들어온다.
          */}
          <View style={[styles.statusBanner, data.activated ? styles.bannerGreen : styles.bannerBlue]}>
            <Text style={styles.bannerTitle}>
              {data.activated
                ? '광고가 나가는 중이에요'
                : data.canActivate
                  ? '아직 안 나가요 — 켜면 나갑니다'
                  : data.readyForProduction
                    ? '실운영 전환 준비 완료'
                    : `아직 안 나가요 · 단계 ${data.currentPhase} 진행 중`}
            </Text>
            {data.blockers.length > 0 && (
              <Text style={styles.bannerSub}>차단 요인: {data.blockers.join(', ')}</Text>
            )}
          </View>

          {/* 게이트 단계 */}
          {data.steps.map((step, i) => (
            <View key={step.id} style={styles.stepCard}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepDot, { backgroundColor: STEP_COLOR[step.status] }]} />
                <View style={styles.stepMain}>
                  <Text style={styles.stepLabel}>{step.label}</Text>
                  <Text style={styles.stepDesc}>{step.description}</Text>
                </View>
                <Text style={[styles.stepStatus, { color: STEP_COLOR[step.status] }]}>
                  {STEP_LABEL[step.status]}
                </Text>
              </View>
              {step.detail && (
                <Text style={styles.stepDetail}>{step.detail}</Text>
              )}
              {step.completedAt && (
                <Text style={styles.stepDate}>
                  완료: {formatDateDot(step.completedAt)}
                </Text>
              )}
              {i < data.steps.length - 1 && <View style={styles.stepConnector} />}
            </View>
          ))}

          {/* 최종 결정 */}
          {data.readyForProduction && (
            <View style={styles.approvalBox}>
              <Text style={styles.approvalTitle}>최종 사용자 결정이 필요해요</Text>
              <Text style={styles.approvalDesc}>
                서로 다른 두 분석이 각각 돌았고, 보고서 2건이 나왔습니다.
                실운영 전환을 확정하려면 아래 버튼을 눌러주세요.
              </Text>
              <Pressable
                style={[styles.approvalBtn, confirming && styles.btnDisabled]}
                onPress={() => { setActionError(null); setAsking({ kind: 'approve' }); }}
                disabled={confirming}
              >
                <Text style={styles.approvalBtnText}>
                  {confirming ? '처리 중…' : '실운영 전환 확정'}
                </Text>
              </Pressable>
              {actionError && <Text style={styles.actionError}>{actionError}</Text>}
            </View>
          )}

          {/*
            실운영 스위치.

            승인과 전환은 다른 일이라 단추도 따로 둔다 — 승인은 «열기로 정했다»는
            기록이고, 이것은 «지금 나간다»는 상태다.
          */}
          {(data.canActivate || data.activated) && (
            <View style={styles.approvalBox}>
              <Text style={styles.approvalTitle}>
                {data.activated ? '광고가 나가는 중이에요' : '켜면 광고가 나가요'}
              </Text>
              <Text style={styles.approvalDesc}>
                {data.activated
                  ? '끄면 곧바로 멈춰요. 승인 기록은 지워지지 않아요.'
                  : '승인은 끝났어요. 이 단추를 눌러야 실제로 나갑니다.'}
              </Text>
              <Pressable
                style={[
                  data.activated ? styles.stopBtn : styles.approvalBtn,
                  confirming && styles.btnDisabled,
                ]}
                onPress={() => {
                  setActionError(null);
                  setAsking({ kind: data.activated ? 'deactivate' : 'activate' });
                }}
                disabled={confirming}
              >
                <Text style={styles.approvalBtnText}>
                  {confirming ? '처리 중…' : data.activated ? '광고 끄기' : '광고 켜기'}
                </Text>
              </Pressable>
              {actionError && <Text style={styles.actionError}>{actionError}</Text>}
            </View>
          )}

          {/*
            상품별 상태.

            **여기가 검색 화면이 실제로 보는 스위치다.** 위의 관문이 열려 있어도
            등급이 «테스트»면 그 등급의 광고는 한 장도 안 나간다. 두 스위치를 한
            화면에 두는 이유가 그것이다 — 따로 두면 «승인했는데 왜 안 나오지»가 된다.
          */}
          {tiers && tiers.length > 0 && (
            <View style={styles.tierBox}>
              <Text style={styles.tierBoxTitle}>상품별 상태</Text>
              <Text style={styles.tierBoxDesc}>
                검색 결과에 실제로 나가는지는 상품마다 따로 정해요.
              </Text>
              {tiers.map((tier) => (
                <View key={tier.tier} style={styles.tierRow}>
                  <View style={styles.tierMain}>
                    <Text style={styles.tierName}>{TIER_LABEL[tier.tier] ?? tier.tier}</Text>
                    <Text style={[styles.tierState, { color: TIER_STATE_COLOR[tier.state] }]}>
                      {TIER_STATE_LABEL[tier.state]}
                    </Text>
                    <Text style={styles.tierMeta}>
                      {tier.placements > 0 ? `오늘 자리 ${tier.placements}건` : '오늘 자리 없음'}
                      {tier.decidedAt ? ` · 정한 날 ${formatDateDot(tier.decidedAt)}` : ''}
                    </Text>
                  </View>
                  <View style={styles.tierActions}>
                    {(['live', 'withheld', 'test'] as const).map((next) => (
                      <Pressable
                        key={next}
                        style={[
                          styles.tierBtn,
                          tier.state === next && styles.tierBtnOn,
                          confirming && styles.btnDisabled,
                        ]}
                        disabled={confirming || tier.state === next}
                        onPress={() => {
                          setActionError(null);
                          setAsking({ kind: 'tier', tier: tier.tier, state: next });
                        }}
                      >
                        <Text
                          style={[styles.tierBtnText, tier.state === next && styles.tierBtnTextOn]}
                        >
                          {next === 'live' ? '실운영' : next === 'withheld' ? '보류' : '테스트'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/*
        **위험한 조작은 무엇이 바뀌는지 항목으로 보여준 뒤 한 번 더 확인한다**(v3.27).
        묻는 것이 넷이라 문구도 넷이다 — 「승인」과 「켜기」를 같은 말로 물으면
        누르는 사람이 둘을 같은 일로 읽는다.
      */}
      {asking?.kind === 'approve' ? (
        <ConfirmCard
          title="실운영 전환을 승인할까요?"
          body="승인은 기록으로 남고, 광고가 지금 켜지지는 않아요."
          items={[
            '실운영 전환 승인이 기록돼요',
            '광고는 아직 안 나가요 — 켜는 것은 따로 눌러야 해요',
            '승인한 사람과 시각이 감사 기록에 남아요',
            '승인은 한 번만 할 수 있어요',
          ]}
          cta="승인"
          danger
          onConfirm={() => void confirmAsked({ kind: 'approve' })}
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {asking?.kind === 'activate' ? (
        <ConfirmCard
          title="광고를 켤까요?"
          body="누르면 실운영으로 연 상품의 광고가 검색 결과에 나갑니다."
          items={[
            '실운영으로 연 상품의 광고가 사용자에게 보여요',
            '테스트·보류 상품은 그대로 안 나가요',
            '켠 사람과 시각이 감사 기록에 남아요',
            '언제든 다시 끌 수 있어요',
          ]}
          cta="켜기"
          danger
          onConfirm={() => void confirmAsked({ kind: 'activate' })}
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {asking?.kind === 'deactivate' ? (
        <ConfirmCard
          title="광고를 끌까요?"
          body="누르면 검색 결과에서 광고가 곧바로 내려갑니다."
          items={[
            '모든 광고가 사용자 화면에서 내려가요',
            '팔린 광고 자리는 지워지지 않아요 — 노출만 멈춰요',
            '승인 기록은 남아요',
            '끈 사람과 시각이 감사 기록에 남아요',
          ]}
          cta="끄기"
          danger
          onConfirm={() => void confirmAsked({ kind: 'deactivate' })}
          onCancel={() => setAsking(null)}
        />
      ) : null}

      {asking?.kind === 'tier' ? (
        <ConfirmCard
          title={`${TIER_LABEL[asking.tier] ?? asking.tier} 상품을 ${
            asking.state === 'live' ? '실운영으로 열까요?' : asking.state === 'withheld' ? '보류할까요?' : '테스트로 되돌릴까요?'
          }`}
          body={
            asking.state === 'live'
              ? '이 상품의 광고가 검색 결과에 나갈 수 있게 됩니다.'
              : '이 상품의 광고가 검색 결과에서 내려갑니다.'
          }
          items={
            asking.state === 'live'
              ? [
                  '이 상품의 광고가 검색 결과에 나가요',
                  '광고 전체 스위치가 꺼져 있으면 그래도 안 나가요',
                  '정한 사람과 시각이 감사 기록에 남아요',
                  '언제든 보류하거나 테스트로 되돌릴 수 있어요',
                ]
              : [
                  '이 상품의 광고가 화면에서 내려가요',
                  '팔린 광고 자리는 지워지지 않아요 — 노출만 멈춰요',
                  '정한 사람과 시각이 감사 기록에 남아요',
                  '다시 실운영으로 열 수 있어요',
                ]
          }
          cta={asking.state === 'live' ? '실운영으로' : asking.state === 'withheld' ? '보류' : '테스트로'}
          danger
          onConfirm={() => void confirmAsked(asking)}
          onCancel={() => setAsking(null)}
        />
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.light.backgroundSelected },
  actionError: { color: Colors.light.negative, fontSize: FontSize.t7, marginTop: Spacing.two },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: Colors.light.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  title: { flex: 1, fontSize: FontSize.t5, fontWeight: '700', color: Colors.light.text },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: Colors.light.backgroundSelected },
  refreshText: { fontSize: FontSize.t7, color: Colors.light.textSecondary },
  body: { flex: 1 },
  bodyContent: { padding: 24, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  errorText: { fontSize: FontSize.t6, color: Colors.light.negative, marginBottom: 16 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, backgroundColor: Colors.light.tint },
  retryText: { fontSize: FontSize.t7, fontWeight: '700', color: Colors.light.background },
  statusBanner: {
    borderRadius: 10,
    padding: 16,
  },
  bannerGreen: { backgroundColor: Colors.light.positiveBackground, borderWidth: 1, borderColor: Colors.light.positive },
  bannerBlue: { backgroundColor: Colors.light.accentBackground, borderWidth: 1, borderColor: Colors.light.accent },
  bannerTitle: { fontSize: FontSize.t6, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  bannerSub: { fontSize: FontSize.t7, color: Colors.light.negative },
  stepCard: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  stepHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  stepMain: { flex: 1 },
  stepLabel: { fontSize: FontSize.t7, fontWeight: '700', color: Colors.light.text },
  stepDesc: { fontSize: FontSize.t7, color: Colors.light.textAssistive, marginTop: 2 },
  stepStatus: { fontSize: FontSize.tab, fontWeight: '700', flexShrink: 0 },
  stepDetail: {
    fontSize: FontSize.t7,
    color: Colors.light.textStrong,
    marginTop: 8,
    paddingLeft: 22,
    lineHeight: LineHeight.t7,
  },
  stepDate: {
    fontSize: FontSize.tab,
    color: Colors.light.textAssistive,
    marginTop: 4,
    paddingLeft: 22,
  },
  stepConnector: {
    position: 'absolute',
    left: 20,
    bottom: -12,
    width: 1,
    height: 12,
    backgroundColor: Colors.light.border,
  },
  approvalBox: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.light.tint,
    marginTop: 8,
  },
  approvalTitle: { fontSize: FontSize.t6, fontWeight: '700', color: Colors.light.text, marginBottom: 8 },
  approvalDesc: { fontSize: FontSize.t7, color: Colors.light.textSecondary, lineHeight: LineHeight.t7, marginBottom: 16 },
  approvalBtn: {
    backgroundColor: Colors.light.tint,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  approvalBtnText: { fontSize: FontSize.t6, fontWeight: '700', color: Colors.light.background },
  /** 끄는 단추. 켜는 것과 같은 색이면 무엇을 누르는지 손이 먼저 헷갈린다. */
  stopBtn: {
    backgroundColor: Colors.light.negative,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },

  // ── 상품별 상태 ───────────────────────────────────────────────
  tierBox: {
    backgroundColor: Colors.light.background,
    borderRadius: 10,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  tierBoxTitle: { fontSize: FontSize.t5, fontWeight: '700', color: Colors.light.text },
  tierBoxDesc: { fontSize: FontSize.t7, color: Colors.light.textAssistive },
  tierRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  tierMain: { gap: 2 },
  tierName: { fontSize: FontSize.t6, fontWeight: '700', color: Colors.light.text },
  tierState: { fontSize: FontSize.t7, fontWeight: '700' },
  tierMeta: { fontSize: FontSize.t7, color: Colors.light.textAssistive },
  tierActions: { flexDirection: 'row', gap: Spacing.one },
  tierBtn: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  tierBtnOn: { backgroundColor: Colors.light.text, borderColor: Colors.light.text },
  tierBtnText: { fontSize: FontSize.t7, fontWeight: '700', color: Colors.light.textSecondary },
  tierBtnTextOn: { color: Colors.light.background },
  btnDisabled: { opacity: 0.5 },
});
