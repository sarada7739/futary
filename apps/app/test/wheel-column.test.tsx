import { useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WheelColumn } from "../components/wheel-column";
import { buildMinuteOptions } from "../lib/time-wheel";

const ITEM_HEIGHT = 40;

// jsdomにはElement.prototype.scrollが無いため、react-native-webの
// scrollResponderScrollToはnode.scrollTop = ...への直接代入にフォールバックする。
// scrollTopをアクセサ化してspyし、「位置合わせのscrollToが走ったか」を検証する。
// box.valueへの直書きは代入spyを経由しないので、「物理的にスクロールした」状態を
// スパイの記録を汚さずに作れる
function attachScrollTopSpy(node: HTMLElement, initial = 0) {
  const box = { value: initial };
  const setSpy = vi.fn((v: number) => {
    box.value = v;
  });
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    get: () => box.value,
    set: setSpy,
  });
  return { box, setSpy };
}

// TimeWheelPickerと同じ形（optionsをvalueから毎回組み立てる）で包んだ
// テスト用ハーネス。刻みに乗らない値がoptionsから出入りする挙動を、
// 本物の統合と同じ経路で再現するため、WheelColumn単体ではなくこの形で試す
function ControlledMinuteWheel({
  initialValue,
  onChangeSpy,
  testID = "minute",
}: {
  initialValue: string;
  onChangeSpy: (value: string) => void;
  testID?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const options = buildMinuteOptions(value);
  return (
    <WheelColumn
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy(next);
      }}
      testID={testID}
    />
  );
}

// R（PR #156レビュー）が発見した4件のバグの回帰テスト。いずれも慣性の
// 実測やiPhone実機を要らず、onScroll/contentOffsetを直接与えれば決定的に
// 再現する（Rの指摘: 「125件緑」はこの経路を1行も通っていなかった）
describe("WheelColumn 位置合わせのscrollTo", () => {
  it("R-1/R-3: 自分のスクロールでvalueが変わっても、位置合わせのscrollToを呼ばない", () => {
    const onChangeSpy = vi.fn();
    const { getByTestId } = render(<ControlledMinuteWheel initialValue="10" onChangeSpy={onChangeSpy} />);
    const node = getByTestId("minute-scroll") as unknown as HTMLElement;
    const { box, setSpy } = attachScrollTopSpy(node);
    setSpy.mockClear(); // 初期マウント時の位置合わせ分を除外する

    // "10" -> "15" へ1行分スクロールしたところを模す
    // (buildMinuteOptions上で"10"はindex=2。ITEM_HEIGHT*3で"15"へ)
    box.value = ITEM_HEIGHT * 3;
    fireEvent.scroll(node);

    expect(onChangeSpy).toHaveBeenCalledWith("15");
    // 自分のスクロール起因のvalue変化では、位置合わせのscrollToを呼ばない
    // （呼ぶと、慣性の途中で実際のスクロール位置と戦ってしまう。Rの指摘）
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("R-2: 刻みに乗らない値から動かして選択肢が減っても、位置を戻さない", () => {
    const onChangeSpy = vi.fn();
    const { getByTestId } = render(<ControlledMinuteWheel initialValue="03" onChangeSpy={onChangeSpy} />);
    const node = getByTestId("minute-scroll") as unknown as HTMLElement;
    const { box, setSpy } = attachScrollTopSpy(node);
    setSpy.mockClear();

    // buildMinuteOptions("03") = ["00","03","05","10",...]。index("05")=2
    box.value = ITEM_HEIGHT * 2;
    fireEvent.scroll(node);

    expect(onChangeSpy).toHaveBeenCalledWith("05");
    // "03"が選択肢から消えてoptions.lengthが13->12に変わっても、
    // 効果はこれを外からの変化と区別できるので位置を戻さない
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("外からvalueが変わったときは、位置を合わせる", () => {
    function ExternallyControlled() {
      const [value, setValue] = useState("10");
      return (
        <>
          <WheelColumn options={buildMinuteOptions(value)} value={value} onChange={setValue} testID="minute" />
          <button onClick={() => setValue("30")}>外から変更</button>
        </>
      );
    }
    const { getByTestId, getByText } = render(<ExternallyControlled />);
    const node = getByTestId("minute-scroll") as unknown as HTMLElement;
    const { setSpy } = attachScrollTopSpy(node);
    setSpy.mockClear();

    fireEvent.click(getByText("外から変更"));

    // WheelColumn自身のonChangeを経由していない変化なので、位置合わせが走る
    // (buildMinuteOptions("30")では刻みに乗るためoptionsは12個。indexは6)
    expect(setSpy).toHaveBeenCalledWith(ITEM_HEIGHT * 6);
  });

  it("R-4: 刻みに乗らない値から離れた行をタップしたら、アニメーションの飛び先も確定後のoptionsで引き直す", () => {
    const onChangeSpy = vi.fn();
    const { getByTestId } = render(<ControlledMinuteWheel initialValue="03" onChangeSpy={onChangeSpy} />);
    const node = getByTestId("minute-scroll") as unknown as HTMLElement;
    const { setSpy } = attachScrollTopSpy(node);
    setSpy.mockClear();

    // buildMinuteOptions("03")は13個で"30"はindex=7（y=280）。タップ時点の
    // indexで飛び先を固定すると、commit後に"03"が消えてoptionsが13->12に
    // 縮み、"30"の正しい位置はindex=6（y=240）になる。飛び先をy=280に固定した
    // まま動かすと、アニメーションの終端がずれたoptionsを読んで違う値
    // （"35"）に着地する（Rの指摘。jsdomはscrollイベントを発火しないため、
    // onChangeの引数だけを見るテストではこの経路を判別できない。実測済み）
    fireEvent.click(getByTestId("minute-option-30"));

    expect(onChangeSpy).toHaveBeenCalledWith("30");
    expect(setSpy).toHaveBeenCalledWith(ITEM_HEIGHT * 6);
    expect(setSpy).not.toHaveBeenCalledWith(ITEM_HEIGHT * 7);
  });
});
