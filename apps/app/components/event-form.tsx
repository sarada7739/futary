import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { Event } from "@futary/contract";
import { Button, Card, radius, space, Text, useTheme } from "@futary/ui";
import { DateInput8 } from "./date-input8";
import { TimeWheelPicker } from "./time-wheel-picker";
import { EVENT_KIND_LABELS, EVENT_KIND_ORDER, type EventKind } from "../lib/event-kind";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// 入力スキーマと同じ下限。上限はここで強制しない（超えたらサーバのエラーで気づく）
const MAX_TITLE_LENGTH = 200;
// 「時間を追加」を押した直後の初期値（5 分刻みなので特別扱いは要らない）
const DEFAULT_TIME = "00:00";

export type EventFormValues = {
  date: string;
  title: string;
  kind: EventKind;
  repeatYearly: boolean;
  startTime?: string;
  endTime?: string;
  isShared: boolean;
};

export type EventFormProps = {
  visible: boolean;
  mode: "create" | "edit";
  defaultDate: string;
  defaultTitle?: string;
  defaultKind?: EventKind;
  defaultStartTime?: string | null;
  defaultEndTime?: string | null;
  // 「ふたりの予定」（021）。plan のときだけ意味を持つ
  defaultIsShared?: boolean;
  // 射影された記念日（表示上の日付 ≠ 登録された日付）を編集しているときの注記
  sourceDateNote?: string;
  // 日付ごとの既存の「会った日」（自分自身は除く）。会った日を選んだときの上書きの注記に使う
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
  defaultStartTime,
  defaultEndTime,
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
  const { colors } = useTheme();
  const [date, setDate] = useState(defaultDate);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [kind, setKind] = useState<EventKind>(defaultKind ?? "plan");
  // null = 未設定。丸めない（刻みに乗らない既存の時刻も保ち、題だけ直して保存しても書き換わらない。
  // event.update は全項目の置き換えなので、画面が持っている値がそのまま送られる。022）
  const [startTime, setStartTime] = useState<string | null>(defaultStartTime ?? null);
  const [endTime, setEndTime] = useState<string | null>(defaultEndTime ?? null);
  const [isShared, setIsShared] = useState(defaultIsShared ?? false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開くたび（別のイベントを編集し直すときも）初期値へ揃える
  useEffect(() => {
    if (!visible) return;
    setDate(defaultDate);
    setTitle(defaultTitle ?? "");
    setKind(defaultKind ?? "plan");
    setStartTime(defaultStartTime ?? null);
    setEndTime(defaultEndTime ?? null);
    setIsShared(defaultIsShared ?? false);
    setConfirmingDelete(false);
  }, [visible, defaultDate, defaultTitle, defaultKind, defaultStartTime, defaultEndTime, defaultIsShared]);

  // isShared は plan のときだけ立てられる（入力スキーマと同じ）。他の種別へ切り替えたら送る前に false へ戻す
  function selectKind(nextKind: EventKind) {
    setKind(nextKind);
    if (nextKind !== "plan") setIsShared(false);
  }

  // サーバは plan 以外 → plan の変換を拒む（締め出しを防ぐ。021）。押しても拒まれるものを選ばせないよう、
  // 元の種別が plan 以外なら選択肢から plan を外す
  const availableKinds =
    mode === "edit" && defaultKind && defaultKind !== "plan"
      ? EVENT_KIND_ORDER.filter((k) => k !== "plan")
      : EVENT_KIND_ORDER;

  const trimmedTitle = title.trim();
  const isAnniversary = kind === "anniversary";
  // 終了は開始より後（同じ日の中だけ）。HH:MM はゼロ詰めなので文字列の比較がそのまま前後になる
  const endTimeValid = endTime == null || (startTime != null && endTime > startTime);

  // 同じ日に自分以外の「会った日」があるか
  const conflictingMeetup = kind === "meetup" ? meetupByDate[date] : undefined;
  const showMeetupNote = conflictingMeetup && conflictingMeetup.id !== editingEventId;
  // create は上書きが正しいので止めない。edit はサーバも上書きしない（INVALID_INPUT）ので送る前に止める
  const blockedByMeetupConflict = mode === "edit" && showMeetupNote;

  const canSubmit =
    trimmedTitle.length > 0 &&
    DATE_PATTERN.test(date) &&
    (isAnniversary || endTimeValid) &&
    !blockedByMeetupConflict;

  // 終了時刻・会った日の重複は常にメッセージを出しているので、ここではタイトル・日付だけを見る
  // （必須項目が空のまま保存を押したとき理由が分かるように）
  const missingFieldMessage =
    trimmedTitle.length === 0
      ? "タイトルを入力してください"
      : !DATE_PATTERN.test(date)
        ? "日付を正しく入力してください"
        : null;

  // 押しても何も起きない、にしない。ボタンは常に押せて、条件が足りなければ理由を出す
  const [showValidation, setShowValidation] = useState(false);

  // 開始が無いと終了は持てない。削除すると終了も一緒に消す
  function removeStartTime() {
    setStartTime(null);
    setEndTime(null);
  }

  async function handleSubmit() {
    if (!canSubmit) {
      setShowValidation(true);
      return;
    }
    // 記念日を選ぶと repeat_yearly が true になる。記念日には時刻を付けられない
    await onSubmit({
      date,
      title: trimmedTitle,
      kind,
      repeatYearly: kind === "anniversary",
      startTime: isAnniversary || startTime == null ? undefined : startTime,
      endTime: isAnniversary || startTime == null || endTime == null ? undefined : endTime,
      isShared: kind === "plan" && isShared,
    });
  }

  // animationType="none" は、閉じた瞬間に react-native-web が children をアンマウントする前提でもある
  // （WheelColumn の ref はアンマウントで戻る想定）。閉じてもアンマウントされない形に変えるときは
  // wheel-column.tsx の前提も見直すこと
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
        {/* 背景は独立したレイヤーとして下に敷く（Pressable の親子で stopPropagation を扱わずに済む）。
            フォームはその上に描かれるので、背景のタップだけがここに届く */}
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="キャンセル"
          testID="event-form-backdrop"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />

        {/* 時刻ホイールでモーダルが画面の高さを超えうるので、中身全体をスクロールできるようにする */}
        <View style={{ width: "100%", maxWidth: 480, maxHeight: "100%" }}>
          <ScrollView>
            <Card>
              <View style={{ gap: space.md }}>
                <Text weight="bold" size="lg">
                  {mode === "edit" ? "イベントを編集" : "イベントを追加"}
                </Text>

                <View style={{ gap: space.xs }}>
                  <Text size="sm" color="muted">
                    日付
                  </Text>
                  <DateInput8 value={date} onChange={setDate} testID="event-form-date" />
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
                  {/* flex:1 で等分すると狭い幅でラベルが単語の途中で折れる。内容の幅で並べ、収まらない分だけ折る */}
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

                {/* plan のときだけ意味を持つ。説明文には今できることだけを書く（動かない機能を先に説明しない。021） */}
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

                {/* 記念日には時刻を設定できないので項目ごと隠す（「日」であって時刻を持つ概念ではない） */}
                {!isAnniversary && (
                  <View style={{ gap: space.sm }}>
                    <Text size="sm" color="muted">
                      時間（任意）
                    </Text>

                    {startTime == null ? (
                      <Button
                        variant="secondary"
                        onPress={() => setStartTime(DEFAULT_TIME)}
                        testID="event-form-add-start-time"
                      >
                        開始時刻を追加
                      </Button>
                    ) : (
                      <View style={{ gap: space.sm }}>
                        <View style={{ gap: space.xs }}>
                          <Text size="xs" color="muted">
                            開始
                          </Text>
                          <TimeWheelPicker value={startTime} onChange={setStartTime} testID="event-form-start-time" />
                        </View>
                        <Button variant="ghost" onPress={removeStartTime} testID="event-form-remove-start-time">
                          時間を削除
                        </Button>

                        {/* 開始を選ぶ前に終了を選べない形にする（押せてから断られる形にしない） */}
                        {endTime == null ? (
                          <Button
                            variant="secondary"
                            onPress={() => setEndTime(DEFAULT_TIME)}
                            testID="event-form-add-end-time"
                          >
                            終了時刻を追加
                          </Button>
                        ) : (
                          <View style={{ gap: space.sm }}>
                            <View style={{ gap: space.xs }}>
                              <Text size="xs" color="muted">
                                終了
                              </Text>
                              <TimeWheelPicker value={endTime} onChange={setEndTime} testID="event-form-end-time" />
                            </View>
                            <Button
                              variant="ghost"
                              onPress={() => setEndTime(null)}
                              testID="event-form-remove-end-time"
                            >
                              終了時刻を削除
                            </Button>
                            {!endTimeValid && (
                              <Text size="xs" color="muted">
                                終了は開始より後にしてください
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
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

                {/* 押しても何も起きない、にしない。保存を一度押したあとだけ、足りない項目を出す */}
                {showValidation && missingFieldMessage && (
                  <Text size="sm" color="muted">
                    {missingFieldMessage}
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
                      <Button onPress={handleSubmit} disabled={isSubmitting} testID="event-form-submit">
                        {isSubmitting ? "保存中…" : "保存する"}
                      </Button>
                    </>
                  )}
                </View>
              </View>
            </Card>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
