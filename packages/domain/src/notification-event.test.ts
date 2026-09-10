import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_POLICY,
  channelsFor,
  templateIdFor,
} from './notification-event';

const OPEN = { templateApproved: true, providerReady: true, hasRecipient: true };

describe('알림 이벤트 정책', () => {
  it('알림톡을 보내는 이벤트는 여섯 가지뿐이다', () => {
    expect([...NOTIFICATION_EVENTS]).toEqual([
      'COUPLE_INVITE',
      'IMPORTANT_SCHEDULE',
      'VERIFICATION_RESULT',
      'ACCOUNT_SECURITY',
      'ACCOUNT_WITHDRAWAL',
      'REWARD_WIN',
    ]);
  });

  it('여섯 이벤트는 모두 서비스 필수 알림이라 하루 한도에 막히지 않는다', () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(NOTIFICATION_EVENT_POLICY[event].essential).toBe(true);
    }
  });

  it('인증 결과는 승인과 반려가 다른 템플릿이다', () => {
    expect(templateIdFor('VERIFICATION_RESULT', 'approved')).toBe('WP_VERIFY_APPROVED');
    expect(templateIdFor('VERIFICATION_RESULT', 'rejected')).toBe('WP_VERIFY_REJECTED');
  });

  it('결과를 주지 않으면 인증 결과 템플릿을 고르지 않는다', () => {
    // 반려를 승인 문안으로 보내는 것보다 안 보내는 쪽이 낫다.
    expect(() => templateIdFor('VERIFICATION_RESULT')).toThrow();
  });

  it('일정 알림톡은 D-1 템플릿 하나다', () => {
    expect(templateIdFor('IMPORTANT_SCHEDULE')).toBe('WP_SCHEDULE_D1');
  });
});

describe('채널 선택', () => {
  it('조건이 모두 맞아야 알림톡이 더해진다', () => {
    expect(channelsFor('COUPLE_INVITE', OPEN)).toEqual(['inbox', 'push', 'alimtalk']);
  });

  it.each([
    ['승인 전', { ...OPEN, templateApproved: false }],
    ['발송 경로 없음', { ...OPEN, providerReady: false }],
    ['수신번호 없음', { ...OPEN, hasRecipient: false }],
  ])('%s이면 알림함과 푸시로만 간다 — 문자로 대신 보내지 않는다', (_label, gate) => {
    expect(channelsFor('COUPLE_INVITE', gate)).toEqual(['inbox', 'push']);
  });

  it('어느 이벤트든 알림함은 언제나 남는다', () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(channelsFor(event, { ...OPEN, providerReady: false })).toContain('inbox');
    }
  });
});
