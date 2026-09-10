/**
 * 알림 이벤트와 채널 정책.
 *
 * **부르는 쪽은 이벤트 이름 하나만 안다.** 배우자 초대를 만드는 코드가 템플릿
 * 번호나 카카오 API를 알면, 채널이 하나 바뀔 때마다 기능 코드를 전부 열어야 한다.
 * 무엇을 어디로 보낼지는 이 표 하나가 정한다.
 *
 * **알림톡은 여기 적힌 것만 나간다.** Pick 추가·추천·신규 업체·할인 같은 것은
 * 이 표에 아예 없다 — 금지 목록을 따로 적어 «빠뜨리면 나가는» 구조로 두지
 * 않는다. 표에 없으면 알림톡 경로가 없다.
 */

import type { NotificationKind, NotificationTopic } from './notification';

export const NOTIFICATION_EVENTS = [
  /** 배우자 초대 */
  'COUPLE_INVITE',
  /** 등록한 중요 일정 임박. 알림톡은 D-1 한 번뿐이고 D-30 · D-7은 푸시다. */
  'IMPORTANT_SCHEDULE',
  /** Pick 인증 승인 · 반려 */
  'VERIFICATION_RESULT',
  /** 계정 · 보안 중요 변경 */
  'ACCOUNT_SECURITY',
  /** 탈퇴 등 중요 계정 상태 */
  'ACCOUNT_WITHDRAWAL',
  /** 참여한 지원금 · 이벤트 당첨과 지급 안내 */
  'REWARD_WIN',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * 한 이벤트가 결과에 따라 다른 문안을 쓰는 경우.
 *
 * 인증 결과는 승인과 반려가 서로 다른 템플릿이다. 그렇다고 이벤트를 둘로 쪼개면
 * 부르는 쪽이 «어느 템플릿인지»를 알게 된다 — 결과는 부르는 쪽이 이미 아는 것이니
 * 결과만 받고 템플릿은 여기서 고른다.
 */
export type NotificationVariant = 'approved' | 'rejected';

export type NotificationChannel = 'inbox' | 'push' | 'alimtalk';

export type NotificationEventPolicy = {
  /** 알림함에서 어떻게 보이는가. */
  kind: NotificationKind;
  /** 왜 보내는가. 하루 한도와 «진행 중 업종만» 규칙이 본다. */
  topic: NotificationTopic;
  /**
   * 서비스 필수 알림인가.
   *
   * 여섯 이벤트는 사용자가 반드시 확인해야 하는 것들이라 하루 한도(13.12)에
   * 막히지 않는다. 당첨 안내가 «오늘은 두 건 다 썼어요»로 사라지면 그 사람은
   * 지급받을 방법을 영영 모른다.
   */
  essential: true;
  /** 결과에 따라 갈리지 않는 이벤트는 하나뿐이다. */
  templateId: string | Record<NotificationVariant, string>;
};

export const NOTIFICATION_EVENT_POLICY: Record<NotificationEvent, NotificationEventPolicy> = {
  COUPLE_INVITE: {
    kind: 'partner',
    topic: 'partner',
    essential: true,
    templateId: 'WP_COUPLE_INVITE',
  },
  IMPORTANT_SCHEDULE: {
    kind: 'notice',
    topic: 'schedule',
    essential: true,
    templateId: 'WP_SCHEDULE_D1',
  },
  VERIFICATION_RESULT: {
    kind: 'verification',
    topic: 'verification',
    essential: true,
    templateId: { approved: 'WP_VERIFY_APPROVED', rejected: 'WP_VERIFY_REJECTED' },
  },
  ACCOUNT_SECURITY: {
    kind: 'notice',
    topic: 'other',
    essential: true,
    templateId: 'WP_ACCOUNT_NOTICE',
  },
  ACCOUNT_WITHDRAWAL: {
    kind: 'notice',
    topic: 'other',
    essential: true,
    templateId: 'WP_ACCOUNT_NOTICE',
  },
  REWARD_WIN: {
    kind: 'notice',
    topic: 'benefit',
    essential: true,
    templateId: 'WP_REWARD_WIN',
  },
};

/**
 * 이 이벤트가 쓸 템플릿.
 *
 * 결과에 따라 갈리는 이벤트에 결과를 주지 않으면 고를 수 없다 — 아무거나 고르지
 * 않고 던진다. 반려를 승인 문안으로 보내는 것보다 안 보내는 쪽이 낫다.
 */
export function templateIdFor(event: NotificationEvent, variant?: NotificationVariant): string {
  const { templateId } = NOTIFICATION_EVENT_POLICY[event];

  if (typeof templateId === 'string') return templateId;

  if (!variant) {
    throw new Error(`${event}는 결과(approved · rejected)를 함께 줘야 템플릿을 고를 수 있다.`);
  }

  return templateId[variant];
}

/**
 * 이 이벤트를 어느 채널로 보내는가.
 *
 * 알림함은 언제나 남긴다 — 푸시를 못 받는 사람도 결과는 볼 수 있어야 한다.
 * 알림톡은 조건이 모두 맞을 때만 더한다. **하나라도 어긋나면 문자로 대신 보내지
 * 않는다**(사용자 지시). 그 경우 푸시와 알림함으로만 간다.
 */
export function channelsFor(
  event: NotificationEvent,
  gate: {
    /** 카카오 심사를 통과한 템플릿인가. spec/alimtalk.templates.json의 approved. */
    templateApproved: boolean;
    /** 실제로 보낼 수 있는 환경인가. 개발 · 테스트에서는 언제나 false다. */
    providerReady: boolean;
    /** 이 사람의 수신번호를 아는가. */
    hasRecipient: boolean;
  }
): NotificationChannel[] {
  const channels: NotificationChannel[] = ['inbox', 'push'];

  if (gate.templateApproved && gate.providerReady && gate.hasRecipient) {
    channels.push('alimtalk');
  }

  return channels;
}
