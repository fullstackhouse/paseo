import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { ControlScreen } from "./client/control";

function ControlItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "control" }), [openScreen]);
  return (
    <SidebarRow icon="Monitor" active={currentScreen?.screenId === "control"} onPress={open} />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "control", title: "Chrome control", Component: ControlScreen });
  client.addSidebarHeaderItem({ id: "control", title: "Chrome control", Component: ControlItem });
  client.addCommandCenterItem({
    id: "control",
    title: "Open Chrome control",
    icon: "Monitor",
    context: "global",
    onSelect: ({ openScreen }) => openScreen({ screenId: "control" }),
  });
  return () => {};
}
