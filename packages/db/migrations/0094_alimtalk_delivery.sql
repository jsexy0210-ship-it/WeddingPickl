-- 알림톡 발송 이력. 사용자 오더(2026-09-09).
--
-- **본문을 쌓지 않는다.** 알림톡 본문에는 이름 · 업체 · 일정처럼 그 사람에 대한
-- 것이 들어간다. 무엇을 언제 보냈고 성공했는지를 알려고 본문을 통째로 남기면,
-- 알림 이력이 개인정보 저장소가 된다. 수신번호와 템플릿 변수값도 같은 이유로
-- 남기지 않는다 — 어느 템플릿을 누구에게 보냈는지는 여기 있고, 그 안에 무슨
-- 글자가 들어갔는지는 spec/alimtalk.templates.json과 원본 데이터를 보면 된다.
--
-- 발송량과 비용은 template_id · created_at 집계로 낸다. 건당 과금이라 «몇 건
-- 나갔나»가 곧 청구서다.

CREATE TABLE structured.alimtalk_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES structured.users (id) ON DELETE CASCADE,

  /** 무슨 일로 보냈는가. packages/domain notification-event.ts의 이벤트 이름. */
  event_type text NOT NULL CHECK (length(btrim(event_type)) > 0),
  /** 어느 템플릿으로 보냈는가. spec/alimtalk.templates.json의 열쇠. */
  template_id text NOT NULL CHECK (length(btrim(template_id)) > 0),

  /*
   * queued  — 보내기로 하고 자리를 잡았다. 같은 열쇠로 두 번 잡히지 않는다.
   * sent    — 대행사가 받았다.
   * failed  — 보내려다 실패했고 더 시도하지 않는다.
   * skipped — 보내지 않기로 했다(승인 전 · 발송 경로 없음 · 수신번호 없음).
   *           실패가 아니다. 이걸 failed로 적으면 «고쳐야 할 것»과 «아직 준비가
   *           안 된 것»이 한 통에 섞인다.
   */
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),

  /** 건너뛴 이유. not_approved · no_provider · no_recipient · non_production. */
  skip_reason text,
  /** 실패 구분. 대행사가 준 코드나 missing_variables. 번호·개인정보를 담지 않는다. */
  failure_code text,
  /** 대행사가 준 발송 번호. 청구 대조와 문의에 쓴다. */
  provider_message_id text,

  /** 다시 시도한 횟수. 무한 재시도를 막는 값이다. */
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),

  /** 무엇에 대한 발송인지 나타내는 열쇠. 알림함의 dedupe_key와 같은 값을 쓴다. */
  dedupe_key text,

  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,

  CONSTRAINT sent_has_time CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

/*
 * 같은 이벤트는 한 번만 나간다.
 *
 * skipped는 세지 않는다 — 승인 전이라 건너뛴 기록이 열쇠를 차지하면, 승인된
 * 뒤에도 그 사람은 영영 못 받는다. 반대로 queued · sent · failed는 이미 한 번
 * 시도한 것이라 다시 잡히지 않아야 한다(건당 과금이다).
 */
CREATE UNIQUE INDEX alimtalk_deliveries_dedupe_idx
  ON structured.alimtalk_deliveries (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status <> 'skipped';

/** 월별 · 템플릿별 발송량. 비용 집계가 이 색인을 쓴다. */
CREATE INDEX alimtalk_deliveries_volume_idx
  ON structured.alimtalk_deliveries (template_id, created_at);

COMMENT ON TABLE structured.alimtalk_deliveries IS
  '알림톡 발송 이력. 본문 · 수신번호 · 템플릿 변수값은 남기지 않는다.';
