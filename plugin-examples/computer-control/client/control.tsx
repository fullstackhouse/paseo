import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import type { z } from "zod";
import {
  actionRpc,
  configureRpc,
  statusRpc,
  type configSchema,
  type taskSchema,
} from "../shared/rpc";

type Colors = PluginScreenProps["theme"]["colors"];
type Task = z.infer<typeof taskSchema>;
type Configuration = z.infer<typeof configSchema>;
type Action = "takeover" | "continue" | "cancel" | "recover";
const stateLabels: Record<Task["state"], string> = {
  queued: "Queued",
  active: "Agent in control",
  holding: "Stopping automation",
  human: "Your turn",
  recovery: "Recovery required",
  completed: "Completed",
  cancelled: "Cancelled",
};
const finishedStates = new Set(["completed", "cancelled"]);

function useStyles(colors: Colors, compact = false) {
  return useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: colors.surface0 },
        content: { padding: compact ? 16 : 24 },
        column: { width: "100%", maxWidth: 800, alignSelf: "center", gap: 20 },
        row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
        stack: { gap: 12 },
        smallStack: { gap: 8 },
        introduction: { flex: 1, minWidth: 180, gap: 4 },
        text: { color: colors.foreground },
        muted: { color: colors.foregroundMuted },
        heading: { fontSize: 22, fontWeight: "600", color: colors.foreground },
        title: {
          flex: 1,
          minWidth: 140,
          fontSize: 16,
          fontWeight: "600",
          color: colors.foreground,
        },
        label: { fontWeight: "600", color: colors.foregroundMuted },
        metadata: { color: colors.foregroundMuted, fontSize: 12 },
        flexText: { color: colors.foreground, flex: 1 },
        card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 16, gap: 10 },
        selectedCard: {
          borderWidth: 1,
          borderColor: colors.accent,
          borderRadius: 8,
          padding: 16,
          gap: 10,
        },
        input: {
          color: colors.foreground,
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 6,
          padding: 12,
        },
        empty: { paddingVertical: 16, gap: 8 },
      }),
    [colors, compact],
  );
}

function ActionButton({
  label,
  onPress,
  colors,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  colors: Colors;
  disabled?: boolean;
  primary?: boolean;
}) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        button: {
          paddingHorizontal: 14,
          paddingVertical: 11,
          borderRadius: 6,
          backgroundColor: primary ? colors.accent : colors.surface1,
          opacity: disabled ? 0.45 : 1,
        },
        text: { color: primary ? colors.accentForeground : colors.foreground, fontWeight: "600" },
      }),
    [colors, disabled, primary],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

function TaskDescription({ task, colors }: { task: Task; colors: Colors }) {
  const styles = useStyles(colors);
  if (task.state === "queued")
    return <Text style={styles.muted}>Waiting for the current task to release Chrome.</Text>;
  if (task.state === "holding")
    return (
      <Text style={styles.text}>
        Wait until automation has stopped before using this task’s tab.
      </Text>
    );
  if (task.state === "recovery")
    return (
      <View style={styles.smallStack}>
        <Text style={styles.text}>
          The previous operation could not be confirmed. The queue remains blocked.
        </Text>
        <Text style={styles.muted}>
          Finish any interaction, close this task’s tab, dismiss pending Chrome prompts, and stop
          its named agent-browser session. Then disable remote debugging at
          chrome://inspect/#remote-debugging. Recovery checks that the connection is closed and
          cancels this task.
        </Text>
      </View>
    );
  if (task.state !== "human") return null;
  return (
    <View style={styles.smallStack}>
      <Text style={styles.text}>
        {task.humanReason || "Complete the requested step in Chrome."}
      </Text>
      <Text style={styles.muted}>
        Automation is paused. Finish your interaction in Chrome before returning control.
      </Text>
      <Text style={styles.muted}>
        {task.cancelRequested
          ? "This task is cancelled; returning control releases its reservation."
          : "Continue lets the agent observe the result and resume."}
      </Text>
    </View>
  );
}

function TaskCard({
  task,
  colors,
  selected,
  refresh,
}: {
  task: Task;
  colors: Colors;
  selected: boolean;
  refresh: () => Promise<unknown>;
}) {
  const styles = useStyles(colors);
  const action = useRpc(actionRpc);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  useEffect(() => setRecoveryConfirmed(false), [task.revision]);
  const mutation = useMutation({
    mutationFn: (kind: Action) =>
      action({ action: kind, taskId: task.id, revision: task.revision }),
    onSuccess: async () => {
      setRecoveryConfirmed(false);
      await refresh();
    },
    onError: async () => {
      await refresh();
    },
  });
  const { mutate } = mutation;
  const takeControl = useCallback(() => mutate("takeover"), [mutate]);
  const continueTask = useCallback(() => mutate("continue"), [mutate]);
  const cancel = useCallback(() => mutate("cancel"), [mutate]);
  const recover = useCallback(() => mutate("recover"), [mutate]);
  const canCancel = ["queued", "active", "human"].includes(task.state) && !task.cancelRequested;
  return (
    <View style={selected ? styles.selectedCard : styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{task.title}</Text>
        <Text style={styles.label}>{stateLabels[task.state]}</Text>
      </View>
      <Text selectable style={styles.metadata}>
        Agent {task.agentId}
        {task.workspaceId ? ` · Workspace ${task.workspaceId}` : ""}
      </Text>
      <TaskDescription task={task} colors={colors} />
      {task.state === "recovery" && (
        <Text selectable style={styles.metadata}>
          Session: {task.session}
        </Text>
      )}
      {task.state === "recovery" && (
        <View style={styles.row}>
          <Switch
            value={recoveryConfirmed}
            onValueChange={setRecoveryConfirmed}
            accessibilityLabel="I closed the task tab, dismissed prompts, stopped its session, and disabled debugging"
          />
          <Text style={styles.flexText}>
            I closed the task tab, dismissed prompts, stopped its session, and disabled debugging.
          </Text>
        </View>
      )}
      {mutation.error && (
        <Text accessibilityRole="alert" style={styles.text}>
          {mutation.error.message}
        </Text>
      )}
      <View style={styles.row}>
        {task.state === "active" && (
          <ActionButton
            label="Take control"
            colors={colors}
            disabled={mutation.isPending}
            onPress={takeControl}
            primary
          />
        )}
        {task.state === "human" && (
          <ActionButton
            label={task.cancelRequested ? "Return control" : "Continue"}
            colors={colors}
            disabled={mutation.isPending}
            onPress={continueTask}
            primary
          />
        )}
        {canCancel && (
          <ActionButton
            label="Cancel task"
            colors={colors}
            disabled={mutation.isPending}
            onPress={cancel}
          />
        )}
        {task.state === "recovery" && (
          <ActionButton
            label="Recover and cancel"
            colors={colors}
            disabled={!recoveryConfirmed || mutation.isPending}
            onPress={recover}
          />
        )}
        {mutation.isPending && <Text style={styles.muted}>Applying…</Text>}
      </View>
    </View>
  );
}

function ConfigurationForm({
  config,
  colors,
  refresh,
}: {
  config: Configuration;
  colors: Colors;
  refresh: () => Promise<unknown>;
}) {
  const styles = useStyles(colors);
  const configure = useRpc(configureRpc);
  const [draft, setDraft] = useState(config);
  const mutation = useMutation({ mutationFn: () => configure(draft), onSuccess: refresh });
  const { mutate } = mutation;
  const save = useCallback(() => mutate(), [mutate]);
  const setBinaryPath = useCallback(
    (binaryPath: string) => setDraft((current) => ({ ...current, binaryPath })),
    [],
  );
  const setEndpoint = useCallback(
    (cdpEndpoint: string) => setDraft((current) => ({ ...current, cdpEndpoint })),
    [],
  );
  const setEnabled = useCallback(
    (enabled: boolean) => setDraft((current) => ({ ...current, enabled })),
    [],
  );
  return (
    <View style={styles.stack}>
      <Text style={styles.muted}>
        On the Chrome host, install agent-browser 0.43.0 and enter its absolute executable path. The
        plugin does not install software or launch Chrome.
      </Text>
      <Text style={styles.muted}>
        Open chrome://inspect/#remote-debugging in the profile you want to use, enable debugging,
        and approve Chrome’s connection prompt when a task starts. Use a loopback port or endpoint.
      </Text>
      <Text style={styles.text}>agent-browser executable</Text>
      <TextInput
        accessibilityLabel="agent-browser executable"
        value={draft.binaryPath}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setBinaryPath}
        style={styles.input}
        placeholder="/absolute/path/to/agent-browser"
        placeholderTextColor={colors.foregroundMuted}
      />
      <Text style={styles.text}>Chrome debugging endpoint</Text>
      <TextInput
        accessibilityLabel="Chrome debugging endpoint"
        value={draft.cdpEndpoint}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setEndpoint}
        style={styles.input}
        placeholder="9222"
        placeholderTextColor={colors.foregroundMuted}
      />
      <View style={styles.row}>
        <Switch
          value={draft.enabled}
          onValueChange={setEnabled}
          accessibilityLabel="Allow new Chrome tasks"
        />
        <Text style={styles.text}>Allow new Chrome tasks</Text>
      </View>
      <Text style={styles.muted}>
        Only tasks using this plugin share its queue. Other browser and desktop tools are outside
        its control. Notifications follow Paseo’s current desktop and phone policy.
      </Text>
      {mutation.error && (
        <Text accessibilityRole="alert" style={styles.text}>
          {mutation.error.message}
        </Text>
      )}
      {mutation.isSuccess && <Text style={styles.muted}>Setup saved.</Text>}
      <View style={styles.row}>
        <ActionButton
          label={mutation.isPending ? "Saving…" : "Save setup"}
          colors={colors}
          primary
          disabled={mutation.isPending || !draft.binaryPath.trim() || !draft.cdpEndpoint.trim()}
          onPress={save}
        />
      </View>
    </View>
  );
}

export function ControlScreen({ theme, layout, params }: PluginScreenProps) {
  const status = useRpc(statusRpc);
  const query = useQuery({
    queryKey: ["computer-control", "status"],
    queryFn: () => status({}),
    refetchInterval: 2000,
  });
  const [showSetup, setShowSetup] = useState(false);
  const colors = theme.colors;
  const styles = useStyles(colors, layout.compact);
  const tasks = query.data?.tasks ?? [];
  const pending = tasks.filter((task) => !finishedStates.has(task.state));
  const finished = tasks.filter((task) => finishedStates.has(task.state));
  const toggleSetup = useCallback(() => setShowSetup((current) => !current), []);
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const subtitle = pending.length
    ? `${pending.length} unfinished tasks`
    : "One task at a time, across your workspaces.";
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.column}>
        <View style={styles.row}>
          <View style={styles.introduction}>
            <Text style={styles.heading}>Chrome control</Text>
            <Text style={styles.muted}>{subtitle}</Text>
          </View>
          <ActionButton
            label={showSetup ? "Hide setup" : "Setup"}
            colors={colors}
            onPress={toggleSetup}
          />
        </View>
        {query.isPending && <Text style={styles.muted}>Loading Chrome tasks…</Text>}
        {query.error && (
          <View style={styles.stack}>
            <Text accessibilityRole="alert" style={styles.text}>
              Cannot load Chrome control: {query.error.message}
            </Text>
            <ActionButton label="Retry" colors={colors} onPress={retry} />
          </View>
        )}
        {query.data?.error && (
          <Text accessibilityRole="alert" style={styles.text}>
            {query.data.error}
          </Text>
        )}
        {query.data && !query.data.config.enabled && (
          <Text style={styles.muted}>
            New Chrome tasks are disabled. Enable them in Setup when your debugging connection is
            ready.
          </Text>
        )}
        {query.data && showSetup && (
          <ConfigurationForm config={query.data.config} colors={colors} refresh={refetch} />
        )}
        {query.data && pending.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.text}>No task needs your attention</Text>
            <Text style={styles.muted}>
              Ask an agent to use the computer-control tools. Its task appears here when it joins
              the queue.
            </Text>
          </View>
        )}
        {pending.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            colors={colors}
            selected={params.taskId === task.id}
            refresh={refetch}
          />
        ))}
        {finished.length > 0 && (
          <View style={styles.stack}>
            <Text style={styles.label}>Recent tasks</Text>
            {finished
              .slice(-10)
              .toReversed()
              .map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  colors={colors}
                  selected={params.taskId === task.id}
                  refresh={refetch}
                />
              ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
