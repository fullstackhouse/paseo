import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { Text, View } from "react-native";
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

interface ComposerQuoteListProps {
  quotes: readonly QuoteComposerAttachment[];
  disabled: boolean;
  onChangeComment: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  /** Enter in a comment field moves on to the message. */
  onSubmitComment: () => void;
}

/** Cited fragments in the order they were cited, each with its own comment field. */
export function ComposerQuoteList({
  quotes,
  disabled,
  onChangeComment,
  onRemove,
  onSubmitComment,
}: ComposerQuoteListProps): ReactElement | null {
  if (quotes.length === 0) return null;
  return (
    <View style={styles.list} testID="composer-quote-list">
      {quotes.map((quote, index) => (
        <QuoteRow
          key={quote.id}
          quote={quote}
          number={index + 1}
          disabled={disabled}
          onChangeComment={onChangeComment}
          onRemove={onRemove}
          onSubmitComment={onSubmitComment}
        />
      ))}
    </View>
  );
}

interface QuoteRowProps {
  quote: QuoteComposerAttachment;
  number: number;
  disabled: boolean;
  onChangeComment: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  onSubmitComment: () => void;
}

function QuoteRow({
  quote,
  number,
  disabled,
  onChangeComment,
  onRemove,
  onSubmitComment,
}: QuoteRowProps): ReactElement {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  const { id } = quote;
  const commentStyle = useMemo(() => [styles.comment, WEB_NO_OUTLINE], []);

  useEffect(() => {
    if (takeQuoteCommentFocus(id)) inputRef.current?.focus();
  }, [id]);

  const handleChange = useCallback(
    (comment: string) => onChangeComment(id, comment),
    [id, onChangeComment],
  );
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);

  return (
    <View style={styles.row} testID="composer-quote-row">
      <View style={styles.number}>
        <Text style={styles.numberText}>{number}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.quote}>
          <Text style={styles.quoteText} numberOfLines={3}>
            {quote.text}
          </Text>
        </View>
        <ThemedTextInput
          ref={inputRef}
          testID="composer-quote-comment"
          // @ts-expect-error - outlineStyle is web-only
          style={commentStyle}
          initialValue={quote.comment ?? ""}
          onChangeText={handleChange}
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
  quoteText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  comment: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[1],
  },
}));
