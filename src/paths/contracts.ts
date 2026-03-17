export type PathVisibility = "visible" | "hidden";
export type PathKind = "file" | "directory";
export type AgentPathOp = "read" | "write" | "edit" | "apply_patch" | "exec" | "list_dir" | "glob";

export interface PathDefinition {
  rel: string;
  kind: PathKind;
  visibility: PathVisibility;
  ops: AgentPathOp[];
  purpose: string;
}
