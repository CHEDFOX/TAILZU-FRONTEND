import type { Field, PillLook, FieldLook } from "./types";
import { SwipeMethodPill } from "./SwipeMethodPill";
import { FieldPill } from "./FieldPill";

/** One sign-in method: the swipe pill, or (variant "field") a plain field and a button. */
export function MethodPill(props: {
  field: Field;
  onSubmit: (f: Field, value: string) => void;
  hintDelay: number;
  resetAt?: number;
  look?: PillLook & FieldLook;
  style?: object;
}) {
  return props.look?.variant === "field"
    ? <FieldPill field={props.field} onSubmit={props.onSubmit} look={props.look} style={props.style} />
    : <SwipeMethodPill {...props} />;
}
