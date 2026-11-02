/** The shell's own shapes: a stack entry, a toast, the boot phase, and the hook plumbing types. */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { consumeKeyboardRecordRequest } from "../../../modules/tulmi-bridge";

export interface NavItem { screenId: string; params?: Record<string, any> }
export interface Toast { message: string; tone?: string }

/** Where the shell is: booting, showing screens, unable to reach the server, or at the sign-in gate. */
export type Phase = "loading" | "ready" | "connect" | "auth";

/** What the keyboard left for this launch: read once at boot, then drained (see SduiApp's kbEntryRef). */
export type KbEntry = { rec: ReturnType<typeof consumeKeyboardRecordRequest>; link: string | null } | null | undefined;

export type SetState<T> = Dispatch<SetStateAction<T>>;
export type Ref<T> = MutableRefObject<T>;
