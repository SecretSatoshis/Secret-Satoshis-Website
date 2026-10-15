"use client";
import { createContext } from "react";
import type { FileView } from "../../../lib/agent21/types";

// The conversation's files, so answer links to sandbox paths and chart blocks
// can find the files they name.
export const ConversationFiles = createContext<FileView[]>([]);
