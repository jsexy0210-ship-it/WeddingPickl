/**
 * 알림톡 발송 포트.
 *
 * 푸시(`push/port.ts`)와 같은 이유로 포트를 둔다 — 기능 코드가 카카오나 발송
 * 대행사의 API를 직접 부르지 않아야, 대행사를 갈아끼울 때 고칠 곳이 여기 하나로
 * 남는다. 대행사는 아직 정해지지 않았다.
 *
 * **본문을 넘기지 않는다.** 대행사는 승인된 템플릿을 이미 들고 있고 변수만 받는다.
 * 본문을 여기로 흘리면 승인본과 다른 글이 나갈 길이 하나 생긴다.
 */

export type AlimtalkRequest = {
  /** 수신번호. 로그·이력 어디에도 남기지 않는다. */
  to: string;
  templateId: string;
  variables: Readonly<Record<string, string>>;
};

export type AlimtalkOutcome =
  | { delivered: true; providerMessageId: string }
  | {
      delivered: false;
      /** 대행사가 준 실패 구분. 번호나 개인정보가 섞이지 않은 코드만 담는다. */
      failureCode: string;
      /**
       * 다시 시도해서 될 실패인가.
       *
       * 잘못된 번호나 반려된 템플릿은 백 번 보내도 같다. 무한 재시도를 막는 것은
       * 횟수 제한이지만, 애초에 다시 시도할 값어치가 있는지는 대행사만 안다.
       */
      retriable: boolean;
    };

export type Alimtalk = {
  send(request: AlimtalkRequest): Promise<AlimtalkOutcome>;
};

/**
 * 아무것도 보내지 않는 구현. **기본값이다.**
 *
 * 대행사 계약·발신프로필·템플릿 승인이 아직 없어서 실제 발송 경로가 없다. 그
 * 상태를 «성공»으로 적으면 나가지 않은 알림이 나간 것으로 남는다 — 보내지 않았고
 * 왜 보내지 않았는지가 이력에 남게 한다.
 */
export const noAlimtalk: Alimtalk = {
  async send() {
    return { delivered: false, failureCode: 'no_provider', retriable: false };
  },
};
