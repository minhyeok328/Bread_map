import { chromium } from "playwright";

export interface BrowserPageLike {
  close(): Promise<void>;
}

export interface BrowserContextLike {
  newPage(): Promise<BrowserPageLike>;
  on(
    event: "page",
    listener: (page: BrowserPageLike) => void
  ): unknown;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export interface ChromiumLauncherLike {
  launch(options: { headless: true }): Promise<BrowserLike>;
}

export interface ReviewBrowserSession {
  page: BrowserPageLike;
  assertSinglePage(): void;
  close(): Promise<void>;
}

export interface OpenReviewBrowserSessionOptions {
  chromiumImpl?: ChromiumLauncherLike;
}

export async function openReviewBrowserSession(
  options: OpenReviewBrowserSessionOptions = {}
): Promise<ReviewBrowserSession> {
  const chromiumImpl =
    options.chromiumImpl ??
    (chromium as unknown as ChromiumLauncherLike);
  const browser = await chromiumImpl.launch({ headless: true });
  let context: BrowserContextLike | undefined;
  let closed = false;

  try {
    context = await browser.newContext();
    const page = await context.newPage();
    let pageLimitExceeded = false;
    context.on("page", (openedPage) => {
      if (openedPage === page) {
        return;
      }
      pageLimitExceeded = true;
      void openedPage.close().catch(() => undefined);
    });

    return {
      page,
      assertSinglePage(): void {
        if (pageLimitExceeded) {
          throw new Error("BROWSER_PAGE_LIMIT_EXCEEDED");
        }
      },
      async close(): Promise<void> {
        if (closed) {
          return;
        }
        closed = true;
        try {
          await context?.close();
        } finally {
          await browser.close();
        }
      }
    };
  } catch {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw new Error("REVIEW_BROWSER_OPEN_FAILED");
  }
}
