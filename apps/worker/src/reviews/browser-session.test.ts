import { describe, expect, it, vi } from "vitest";
import {
  openReviewBrowserSession,
  type ChromiumLauncherLike
} from "./browser-session.js";

describe("review browser session", () => {
  it("opens one headless page without artifact or persistent options", async () => {
    const page = { close: vi.fn(async () => undefined) };
    const popup = { close: vi.fn(async () => undefined) };
    let pageListener: ((value: typeof popup) => void) | undefined;
    const context = {
      newPage: vi.fn(async () => page),
      on: vi.fn(
        (
          event: string,
          listener: (value: typeof popup) => void
        ) => {
          if (event === "page") {
            pageListener = listener;
          }
        }
      ),
      close: vi.fn(async () => undefined)
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined)
    };
    const chromiumImpl: ChromiumLauncherLike = {
      launch: vi.fn(async () => browser)
    };

    const session = await openReviewBrowserSession({
      chromiumImpl
    });

    expect(chromiumImpl.launch).toHaveBeenCalledWith({
      headless: true
    });
    expect(browser.newContext).toHaveBeenCalledWith();
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(session.page).toBe(page);
    expect(session.assertSinglePage).not.toThrow();

    pageListener?.(popup);
    expect(session.assertSinglePage).toThrow(
      "BROWSER_PAGE_LIMIT_EXCEEDED"
    );
    await vi.waitFor(() =>
      expect(popup.close).toHaveBeenCalledTimes(1)
    );

    await session.close();
    await session.close();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser even when context shutdown fails", async () => {
    const page = { close: vi.fn(async () => undefined) };
    const context = {
      newPage: vi.fn(async () => page),
      on: vi.fn(),
      close: vi.fn(async () => {
        throw new Error("private context failure");
      })
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined)
    };

    const session = await openReviewBrowserSession({
      chromiumImpl: {
        launch: vi.fn(async () => browser)
      }
    });

    await expect(session.close()).rejects.toThrow(
      "private context failure"
    );
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
