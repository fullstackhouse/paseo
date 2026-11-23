import { useCallback, useRef } from "react";
import { View, type TextInputProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { BrowserLiveFocus } from "@getpaseo/protocol/browser-automation/live-view";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";

interface FieldTraits {
  label: string;
  secure: boolean;
  textContentType: NonNullable<TextInputProps["textContentType"]>;
  autoComplete: NonNullable<TextInputProps["autoComplete"]>;
  keyboardType?: TextInputProps["keyboardType"];
}

// The OS reads both hints to decide what a password manager offers.
export function getFieldTraits(kind: string): FieldTraits {
  switch (kind) {
    case "password":
      return {
        label: "workspace.browser.liveView.fields.password",
        secure: true,
        textContentType: "password",
        autoComplete: "current-password",
      };
    case "new_password":
      return {
        label: "workspace.browser.liveView.fields.newPassword",
        secure: true,
        // "newPassword" covers the field with iOS's own strong-password offer.
        textContentType: "password",
        autoComplete: "new-password",
      };
    case "one_time_code":
      return {
        label: "workspace.browser.liveView.fields.oneTimeCode",
        secure: false,
        textContentType: "oneTimeCode",
        autoComplete: "one-time-code",
      };
    case "username":
      return {
        label: "workspace.browser.liveView.fields.username",
        secure: false,
        textContentType: "username",
        autoComplete: "username",
      };
    case "email":
      return {
        label: "workspace.browser.liveView.fields.email",
        secure: false,
        textContentType: "emailAddress",
        autoComplete: "email",
        keyboardType: "email-address",
      };
    case "text":
      return {
        label: "workspace.browser.liveView.fields.text",
        secure: false,
        textContentType: "none",
        autoComplete: "off",
      };
    default:
      // "secret", and whatever a newer desktop adds: mask it.
      return {
        label: "workspace.browser.liveView.fields.secret",
        secure: true,
        textContentType: "none",
        autoComplete: "off",
      };
  }
}

/**
 * The native field a password manager fills. Its text stays in the input until Send, then it is
 * cleared: never in a store, a form model, or a draft. Mount it with a key per target, so text
 * meant for one field can't follow focus to another.
 */
export function SecretTextInput(props: {
  focus: BrowserLiveFocus;
  canSend: boolean;
  onSubmit: (text: string) => void;
}) {
  const { focus, canSend, onSubmit } = props;
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const traits = getFieldTraits(focus.kind);
  const label = t(traits.label);

  const submit = useCallback(() => {
    const text = inputRef.current?.getText();
    if (!text || !canSend) return;
    inputRef.current?.replaceText("");
    onSubmit(text);
  }, [canSend, onSubmit]);

  return (
    <View style={styles.row}>
      <View style={styles.input}>
        <FormTextInput
          ref={inputRef}
          testID="browser-live-secret-input"
          accessibilityLabel={label}
          placeholder={label}
          autoFocus
          secureTextEntry={traits.secure}
          textContentType={traits.textContentType}
          autoComplete={traits.autoComplete}
          keyboardType={traits.keyboardType}
          importantForAutofill="yes"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={submit}
        />
      </View>
      <Button variant="default" disabled={!canSend} onPress={submit} testID="browser-live-send">
        {t("workspace.browser.liveView.control.send")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    flex: 1,
    minWidth: 0,
  },
}));
