"use client";

import Image from "next/image";
import {
  useEffect
} from "react";

export interface ChatStoreContext {
  displayName: string;
  normalizedAddress: string;
}

export interface ChatShellProps {
  storeContext: ChatStoreContext | null;
  onClose(): void;
}

export function ChatShell({
  storeContext,
  onClose
}: ChatShellProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <section
      id="bbangbbang-chat"
      className="chat-shell"
      role="region"
      aria-labelledby="chat-heading"
    >
      <header className="chat-header">
        <div className="chat-brand">
          <Image
            src="/brand/bbangbbang.svg"
            width="44"
            height="44"
            alt=""
          />
          <div>
            <p className="eyebrow">BREAD GUIDE</p>
            <h2 id="chat-heading">빵빵이</h2>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="빵빵이 닫기"
          title="빵빵이 닫기"
          autoFocus
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="chat-context">
        <span className="context-label">현재 보고 있는 가게</span>
        {storeContext ? (
          <>
            <strong>{storeContext.displayName}</strong>
            <span>{storeContext.normalizedAddress}</span>
          </>
        ) : (
          <>
            <strong>아직 선택한 가게가 없어요</strong>
            <span>목록에서 가게를 열면 여기에 표시됩니다.</span>
          </>
        )}
      </div>

      <div className="chat-message">
        <Image
          src="/brand/bbangbbang.svg"
          width="36"
          height="36"
          alt=""
        />
        <div>
          <strong>
            챗봇 기능은 다음 단계에서 제공할 예정이에요.
          </strong>
          <p>지금은 지도와 가게 검색을 이용해 주세요.</p>
        </div>
      </div>

      <div
        className="chat-suggestions"
        aria-label="사용할 수 없는 제안"
      >
        <button type="button" disabled>
          이 가게의 대표 메뉴
        </button>
        <button type="button" disabled>
          방문 전 확인할 점
        </button>
      </div>

      <div className="disabled-composer">
        <label htmlFor="chat-composer">메시지</label>
        <textarea
          id="chat-composer"
          value="현재는 메시지를 입력할 수 없어요"
          disabled
          readOnly
          rows={2}
        />
        <span>채팅 입력은 후속 Feature에서 열립니다.</span>
      </div>
    </section>
  );
}
