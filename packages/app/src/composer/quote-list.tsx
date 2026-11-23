import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ForwardedRef,
  type ReactElement,
  type RefObject,
} from "react";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { QuoteComposerAttachment } from "@/attachments/types";
import { Button } from "@/components/ui/button";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const WEB_NO_OUTLINE = isWeb ? { outlineStyle: "none" } : null;
const QUOTE_MAX_HEIGHT = 160;

const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

let pendingCommentFocusId: string | null = null;

/** The quote with this id takes focus in its comment field when it appears in the composer. */
export function requestQuoteCommentFocus(id: string): void {
  pendingCommentFocusId = id;
}

function takeQuoteCommentFocus(id: string): boolean {
  if (pendingCommentFocusId !== id) return false;
  pendingCommentFocusId = null;
  return true;
}

type InputRef = RefObject<EditingTextInputHandle | null>;

function focusAtEnd(ref: InputRef | undefined): boolean {
  const input = ref?.current;
  if (!input) return false;
  input.focus();
  const end = input.getText().length;
  input.setSelection({ start: end, end });
  return true;
}

/** True when the caret sits at the very start with nothing selected (web only). */
function caretAtStart(ref: InputRef): boolean {
  const element = ref.current?.getNativeRef();
  if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) {
    return false;
  }
  return element.selectionStart === 0 && element.selectionEnd === 0;
}

/** A web textarea grows with its text up to a cap, then scrolls. */
function useGrowingTextarea(ref: InputRef, text: string, maxHeight: number): void {
  useLayoutEffect(() => {
    const element = ref.current?.getNativeRef();
    if (!(element instanceof HTMLTextAreaElement)) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  }, [ref, text, maxHeight]);
}

interface ComposerQuoteListProps {
  quotes: readonly QuoteComposerAttachment[];
  disabled: boolean;
  onChangeQuote: (id: string, update: { text?: string; comment?: string }) => void;
  onRemove: (id: string) => void;
  /** Enter in a comment field, or removing the first quote, moves on to the message. */
  onFocusMessage: () => void;
}

interface RowFields {
  quote: InputRef;
  comment: InputRef;
}

export interface ComposerQuoteListHandle {
  /** Backspace at the start of the message steps up into the last quote's comment. */
  focusLastComment: () => boolean;
}

/**
 * Cited fragments in the order they were cited. Each quote is editable and has its own
 * comment field; Backspace walks up through them and removes an emptied quote, like text.
 */
export const ComposerQuoteList = forwardRef<ComposerQuoteListHandle, ComposerQuoteListProps>(
  function ComposerQuoteList(props, ref) {
    return <QuoteListBody {...props} handleRef={ref} />;
  },
);

function QuoteListBody({
  quotes,
  disabled,
  onChangeQuote,
  onRemove,
  onFocusMessage,
  handleRef,
}: ComposerQuoteListProps & {
  handleRef: ForwardedRef<ComposerQuoteListHandle>;
}): ReactElement | null {
  const rows = useRef(new Map<string, RowFields>());
  const ids = useMemo(() => quotes.map((quote) => quote.id), [quotes]);
  useImperativeHandle(
    handleRef,
    () => ({
      focusLastComment: () => {
        const last = ids[ids.length - 1];
        return last ? focusAtEnd(rows.current.get(last)?.comment) : false;
      },
    }),
    [ids],
  );

  const register = useCallback((id: string, fields: RowFields | null) => {
    if (fields) rows.current.set(id, fields);
    else rows.current.delete(id);
  }, []);

  const removeAndFocusPrevious = useCallback(
    (id: string) => {
      const previous = ids[ids.indexOf(id) - 1];
      onRemove(id);
      if (!previous || !focusAtEnd(rows.current.get(previous)?.comment)) onFocusMessage();
    },
    [ids, onFocusMessage, onRemove],
  );

  if (quotes.length === 0) return null;
  return (
    <View style={styles.list} testID="composer-quote-list">
      {quotes.map((quote, index) => (
        <QuoteRow
          key={quote.id}
          quote={quote}
          number={index + 1}
          disabled={disabled}
          register={register}
          onChangeQuote={onChangeQuote}
          onRemove={removeAndFocusPrevious}
          onSubmitComment={onFocusMessage}
        />
      ))}
    </View>
  );
}

interface QuoteRowProps {
  quote: QuoteComposerAttachment;
  number: number;
  disabled: boolean;
  register: (id: string, fields: RowFields | null) => void;
  onChangeQuote: (id: string, update: { text?: string; comment?: string }) => void;
  onRemove: (id: string) => void;
  onSubmitComment: () => void;
}

function QuoteRow({
  quote,
  number,
  disabled,
  register,
  onChangeQuote,
  onRemove,
  onSubmitComment,
}: QuoteRowProps): ReactElement {
  const { t } = useTranslation();
  const quoteRef = useRef<EditingTextInputHandle | null>(null);
  const commentRef = useRef<EditingTextInputHandle | null>(null);
  const { id } = quote;
  const quoteStyle = useMemo(() => [styles.quoteInput, WEB_NO_OUTLINE], []);
  const commentStyle = useMemo(() => [styles.comment, WEB_NO_OUTLINE], []);
  useGrowingTextarea(quoteRef, quote.text, QUOTE_MAX_HEIGHT);

  useEffect(() => {
    register(id, { quote: quoteRef, comment: commentRef });
    if (takeQuoteCommentFocus(id)) commentRef.current?.focus();
    return () => register(id, null);
  }, [id, register]);

  const handleQuoteChange = useCallback(
    (text: string) => onChangeQuote(id, { text }),
    [id, onChangeQuote],
  );
  const handleCommentChange = useCallback(
    (comment: string) => onChangeQuote(id, { comment }),
    [id, onChangeQuote],
  );
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);

  // Backspace in an empty quote removes it, like deleting an emptied paragraph.
  const handleQuoteKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key !== "Backspace" || quoteRef.current?.getText()) return;
      event.preventDefault();
      onRemove(id);
    },
    [id, onRemove],
  );
  // Backspace at the start of the comment steps up into the quote above it.
  const handleCommentKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key !== "Backspace" || !caretAtStart(commentRef)) return;
      event.preventDefault();
      focusAtEnd(quoteRef);
    },
    [],
  );

  return (
    <View style={styles.row} testID="composer-quote-row">
      <View style={styles.number}>
        <Text style={styles.numberText}>{number}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.quote}>
          <ThemedTextInput
            ref={quoteRef}
            testID="composer-quote-text"
            // @ts-expect-error - outlineStyle is web-only
            style={quoteStyle}
            multiline
            initialValue={quote.text}
            onChangeText={handleQuoteChange}
            onKeyPress={handleQuoteKeyPress}
            editable={!disabled}
            accessibilityLabel={t("composer.attachments.quoteText", { number })}
          />
        </View>
        <ThemedTextInput
          ref={commentRef}
          testID="composer-quote-comment"
          // @ts-expect-error - outlineStyle is web-only
          style={commentStyle}
          initialValue={quote.comment ?? ""}
          onChangeText={handleCommentChange}
          onKeyPress={handleCommentKeyPress}
          onSubmitEditing={onSubmitComment}
          blurOnSubmit={false}
          editable={!disabled}
          placeholder={t("composer.attachments.quoteComment", { number })}
          accessibilityLabel={t("composer.attachments.quoteComment", { number })}
        />
      </View>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={X}
        onPress={handleRemove}
        disabled={disabled}
        accessibilityLabel={t("composer.attachments.removeQuote", { number })}
        testID="composer-quote-remove"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  number: {
    width: 20,
    height: 20,
    marginTop: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.borderAccent,
    paddingLeft: theme.spacing[2],
  },
  quoteInput: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    padding: 0,
  },
  comment: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[1],
  },
}));
