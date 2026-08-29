import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Screen, layout } from "@futary/ui";
import { Text } from "react-native";

describe("Screen（L59: 画面の最大幅制約）", () => {
  it("既定でlayout.maxWidthに制約される", () => {
    render(
      <Screen>
        <Text testID="content">中身</Text>
      </Screen>,
    );
    const content = screen.getByTestId("content");
    const constrained = content.closest("[style*=\"max-width\"]") as HTMLElement | null;
    expect(constrained).not.toBeNull();
    expect(constrained!.style.maxWidth).toBe(`${layout.maxWidth}px`);
  });

  it("unconstrainedを渡すと制約が外れる", () => {
    render(
      <Screen unconstrained>
        <Text testID="content-unconstrained">中身</Text>
      </Screen>,
    );
    const content = screen.getByTestId("content-unconstrained");
    const constrained = content.closest("[style*=\"max-width\"]");
    expect(constrained).toBeNull();
  });
});
