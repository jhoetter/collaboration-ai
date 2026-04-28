import type { ComponentType } from "react";

export interface CollabAiRuntimeConfig {
  apiBase?: string;
  workspaceId?: string;
  identity?: { id: string; name?: string; email?: string };
  getAuthToken?: () => Promise<string>;
}
export interface CollabAiHostProps {
  runtime?: CollabAiRuntimeConfig;
}
export interface CollabAiRouteDefinition {
  path: string;
}
export declare const product: "collabai";
export declare const routes: CollabAiRouteDefinition[];
export declare const collabAiRoutes: CollabAiRouteDefinition[];
export declare const CollabAiHost: ComponentType<CollabAiHostProps>;
export { CollabAiHost as Host };
