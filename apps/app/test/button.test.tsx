import { render, fireEvent, act } from "@testing-library/react";
import { Button } from "@futary/ui";
import { describe, expect, it, vi } from "vitest";

// ボタンの二重発火を防ぐ（conventions.md 4節）。ログインボタンの二重発火は OAuth の state 競合を起こす
describe("Button の二重発火防止", () => {
  it("素早く2回押しても、同期の onPress は1回しか走らない", () => {
    const onPress = vi.fn();
    const { getByText } = render(<Button onPress={onPress}>押す</Button>);
    const button = getByText("押す");

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("非同期の onPress が解決するまで、2回目の押下は無視される", async () => {
    let resolvePress: () => void = () => {};
    const onPress = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePress = resolve;
        }),
    );
    const { getByText } = render(<Button onPress={onPress}>送信</Button>);
    const button = getByText("送信");

    fireEvent.click(button);
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePress();
      await Promise.resolve();
    });

    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("同期の onPress が例外を投げても、ガードが固着せず次のクリックで再度呼べる", () => {
    const onPress = vi.fn(() => {
      throw new Error("テスト用エラー");
    });
    const { getByText } = render(<Button onPress={onPress}>押す</Button>);
    const button = getByText("押す");

    // React 19 はハンドラ内の例外を非同期に window の error イベントとして報告する（fireEvent.click は
    // throw しない）ので、伝播は握りつぶし、「ガードが固着しないこと」だけを見る
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", swallow);
    fireEvent.click(button);
    fireEvent.click(button);
    window.removeEventListener("error", swallow);

    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("非同期の onPress が reject しても、ガードが固着せず次のクリックで再度呼べる", async () => {
    const onPress = vi.fn().mockRejectedValue(new Error("テスト用エラー"));
    const { getByText } = render(<Button onPress={onPress}>送信</Button>);
    const button = getByText("送信");

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve().then(() => Promise.resolve());
    });

    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("disabled のときは押しても onPress が呼ばれない", () => {
    const onPress = vi.fn();
    const { getByText } = render(
      <Button onPress={onPress} disabled>
        押す
      </Button>,
    );

    fireEvent.click(getByText("押す"));

    expect(onPress).not.toHaveBeenCalled();
  });
});
