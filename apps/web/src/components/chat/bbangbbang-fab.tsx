"use client";

import Image from "next/image";
import {
  forwardRef
} from "react";

export interface BbangbbangFabProps {
  onOpen(): void;
}

export const BbangbbangFab = forwardRef<
  HTMLButtonElement,
  BbangbbangFabProps
>(function BbangbbangFab({ onOpen }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="bbangbbang-fab"
      aria-label="빵빵이에게 물어보기"
      aria-controls="bbangbbang-chat"
      aria-expanded="false"
      title="빵빵이에게 물어보기"
      onClick={onOpen}
    >
      <Image
        src="/brand/bbangbbang.svg"
        width="48"
        height="48"
        alt=""
      />
      <span className="fab-tooltip" aria-hidden="true">
        빵빵이
      </span>
    </button>
  );
});
