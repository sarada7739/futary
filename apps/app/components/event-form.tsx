import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import type { Event } from "@futary/contract";
import { Button, Card, colors, radius, space, Text } from "@futary/ui";
import { EVENT_KIND_LABELS, EVENT_KIND_ORDER, type EventKind } from "../lib/event-kind";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// eventInputSchema（packages/contract/src/event.ts）と同じ形式
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// eventInputSchema（packages/contract/src/event.ts）と同じ下限。
// 上限はここでは強制しない（超えたらサーバのエラーメッセージで気づく）
const MAX_TITLE_LENGTH = 200;

export type EventFormValues = {
  date: string;
  title: string;
  kind: EventKind;
  repeatYearly: boolean;
  time?: string;
  isShared: boolean;
};

export type EventFormProps = {
  visible: boolean;
  mode: "create" | "edit";
  defaultDate: string;
  defaultTitle?: string;
  defaultKind?: EventKind;
  defaultTime?: string | null;
  // 「ふたりの予定」（021）。kind='plan'のときだけ意味を持つ
  defaultIsShared?: boolean;
  // 射影された記念日（表示上の日付 ≠ 登録された日付）を編集しているときの注記
  sourceDateNote?: string;
  // 日付ごとの既存の「会った日」（自分自身は除く）。kind='meetup'を選んだときの
  // 上書き注記に使う（018）
  meetupByDate: Record<string, Event>;
  editingEventId?: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: EventFormValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onCancel: () => void;
};

export function EventForm({
  visible,
  mode,
  defaultDate,
  defaultTitle,
  defaultKind,
  defaultTime,
  defaultIsShared,
  sourceDateNote,
  meetupByDate,
  editingEventId,
  isSubmitting,
  errorMessage,
  onSubmit,
  onDelete,
  onCancel,
}: EventFormProps) {
  const [date, setDate] = useState(defaultDate);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [kind, setKind] = useState<EventKind>(defaultKind ?? "plan");
  const [time, setTime] = useState(defaultTime ?? "");
  const [isShared, setIsShared] = useState(defaultIsShared ?? false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開くたび（別のイベントを編集し直す場合を含む）に初期値へ揃える
  useEffect(() => {
    if (!visible) return;
    setDate(defaultDate);
    setTitle(defaultTitle ?? "");
    setKind(defaultKind ?? "plan");
    setTime(defaultTime ?? "");
    setIsShared(defaultIsShared ?? false);
    setConfirmingDelete(false);
  }, [visible, defaultDate, defaultTitle, defaultKind, defaultTime, defaultIsShared]);

  // isSharedはkind='plan'のときだけ立てられる（入力スキーマのrefineと同じ判断。
  // 021）。他のkindへ切り替えたら送信前にfalseへ戻す
  function selectKind(nextKind: EventKind) {
    setKind(nextKind);
    if (nextKind !== "plan") setIsShared(false);
  }

  // 021: 記念日・会った日〈どちらでも編集できる〉から非共有planへの変換で
  // 相手（または自分）を締め出せる経路があったため、区分をまたぐ変換自体を
  // サーバのWHERE句で禁じた（docs/tasks/021-plan-ownership.md「権限の条件を
  // 『操作』ではなく『状態遷移』で書く」）。編集中のイベントの元の種別が
  // plan以外なら、選択肢からplanそのものを外す（押しても拒まれるものを
  // 選ばせない）。「ふたりの予定」を条件付きで固定する形はこれで不要になった
  const availableKinds =
    mode === "edit" && defaultKind && defaultKind !== "plan"
      ? EVENT_KIND_ORDER.filter((k) => k !== "plan")
      : EVENT_KIND_ORDER;

  const trimmedTitle = title.trim();
  const trimmedTime = time.trim();
  const isAnniversary = kind === "anniversary";
  const timeValid = trimmedTime.length === 0 || TIME_PATTERN.test(trimmedTime);

  // 同じ日に自分以外の「会った日」が既にあるか（018）
  const conflictingMeetup = kind === "meetup" ? meetupByDate[date] : undefined;
  const showMeetupNote = conflictingMeetup && conflictingMeetup.id !== editingEventId;
  // create は上書きが正しい挙動なので止めない。edit はサーバでも上書きしない
  // 設計（INVALID_INPUT）のため、送信前にここで止める（018）
  const blockedByMeetupConflict = mode === "edit" && showMeetupNote;

  const canSubmit =
    trimmedTitle.length > 0 && DATE_PATTERN.test(date) && (isAnniversary || timeValid) && !blockedByMeetupConflict;

  async function handleSubmit() {
    if (!canSubmit) return;
    // 記念日を選ぶと repeat_yearly が自動で true になる（タスク011）。
    // 記念日には time を付けられない（018・入力スキーマのrefineと同じ判断）
    await onSubmit({
      date,
      title: trimmedTitle,
      kind,
      repeatYearly: kind === "anniversary",
      time: isAnniversary || trimmedTime.length === 0 ? undefined : trimmedTime,
      isShared: kind === "plan" && isShared,
    });
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
        {/* 背景は独立したレイヤーとして下に敷く（Pressable の親子でstopPropagationを
            扱う必要を無くす。017で当たり判定の穴を踏んだのと同じ回避）。
            フォーム本体はその上に描画されるため、背景タップだけがここに到達する */}
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="キャンセル"
          testID="event-form-backdrop"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />

        <View style={{ width: "100%", maxWidth: 480 }}>
          <Card>
            <View style={{ gap: space.md }}>
              <Text weight="bold" size="lg">
                {mode === "edit" ? "イベントを編集" : "イベントを追加"}
              </Text>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  日付
                </Text>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textMuted}
                  testID="event-form-date"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.input,
                    padding: space.md,
                    fontSize: 16,
                    color: colors.text,
                  }}
                />
                {sourceDateNote && (
                  <Text size="xs" color="muted">
                    {sourceDateNote}
                  </Text>
                )}
              </View>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  タイトル
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="イベントの名前"
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_TITLE_LENGTH}
                  testID="event-form-title"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.input,
                    padding: space.md,
                    fontSize: 16,
                    color: colors.text,
                  }}
                />
              </View>

              <View style={{ gap: space.xs }}>
                <Text size="sm" color="muted">
                  種別
                </Text>
                {/* flex:1で等分すると、狭い幅ではラベルが単語の途中で
                    折り返される（profile.tsxの「ホーム上部の表示」と同じ形。
                    Rレビュー指摘）。ボタンを内容の幅で並べ、収まらない分だけ
                    次の行へ折り返す */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {availableKinds.map((k) => (
                    <Button
                      key={k}
                      variant={kind === k ? "primary" : "secondary"}
                      onPress={() => selectKind(k)}
                      testID={`event-form-kind-${k}`}
                    >
                      {EVENT_KIND_LABELS[k]}
                    </Button>
                  ))}
                </View>
                {kind === "anniversary" && (
                  <Text size="xs" color="muted">
                    記念日は毎年繰り返し表示されます
                  </Text>
                )}
              </View>

              {/* 021: is_sharedはkind='plan'のときだけ意味を持つ。3（翌日「会った日」に
                  変わる）は公開後へ回したため、説明文には現時点でできることだけを書く
                  （「翌日『会った日』になります」とは書かない。動かない機能を先に
                  説明しない。020の「準備中です」を避けたのと同じ判断。
                  docs/tasks/021-plan-ownership.md） */}
              {kind === "plan" && (
                <View style={{ gap: space.xs }}>
                  <Button
                    variant={isShared ? "primary" : "secondary"}
                    onPress={() => setIsShared((v) => !v)}
                    testID="event-form-is-shared"
                  >
                    {isShared ? "✓ ふたりの予定" : "ふたりの予定にする"}
                  </Button>
                  <Text size="xs" color="muted">
                    チェックすると、相手も編集・削除できるようになります
                  </Text>
                </View>
              )}

              {/* 記念日には時間を設定できない（入力スキーマのrefineと同じ判断。018）。
                  項目自体を隠す（「日」であって時刻を持つ概念ではないため） */}
              {!isAnniversary && (
                <View style={{ gap: space.xs }}>
                  <Text size="sm" color="muted">
                    時間（任意）
                  </Text>
                  <TextInput
                    value={time}
                    onChangeText={setTime}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.textMuted}
                    testID="event-form-time"
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.input,
                      padding: space.md,
                      fontSize: 16,
                      color: colors.text,
                    }}
                  />
                  {!timeValid && (
                    <Text size="xs" color="muted">
                      時間はHH:MM形式で指定してください
                    </Text>
                  )}
                </View>
              )}

              {showMeetupNote && (
                <Text size="xs" color="muted">
                  {mode === "create"
                    ? `この日はすでに「会った日」が登録されています（${conflictingMeetup?.title}）。保存すると上書きされます`
                    : `この日には既に別の「会った日」があります（${conflictingMeetup?.title}）。保存できません`}
                </Text>
              )}

              {errorMessage && (
                <Text size="sm" color="muted">
                  {errorMessage}
                </Text>
              )}

              <View style={{ flexDirection: "row", gap: space.sm, justifyContent: "flex-end" }}>
                {mode === "edit" &&
                  onDelete &&
                  (confirmingDelete ? (
                    <>
                      <Button variant="ghost" onPress={() => setConfirmingDelete(false)}>
                        キャンセル
                      </Button>
                      <Button variant="secondary" onPress={onDelete} testID="event-form-delete-confirm">
                        削除する
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onPress={() => setConfirmingDelete(true)} testID="event-form-delete">
                      削除
                    </Button>
                  ))}
                {!confirmingDelete && (
                  <>
                    <Button variant="ghost" onPress={onCancel}>
                      閉じる
                    </Button>
                    <Button
                      onPress={handleSubmit}
                      disabled={!canSubmit}
                      testID="event-form-submit"
                    >
                      {isSubmitting ? "保存中…" : "保存する"}
                    </Button>
                  </>
                )}
              </View>
            </View>
          </Card>
        </View>
      </View>
    </Modal>
  );
}
