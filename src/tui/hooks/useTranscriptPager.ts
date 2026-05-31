import { useState, useCallback } from "react";

export interface UseTranscriptPagerResult {
  isOpen: boolean;
  open: (messageCount: number) => void;
  close: () => void;
  frozenCount: number | null;
  searchQuery: string;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: (query: string) => void;
  dumpMode: boolean;
  enableDumpMode: () => void;
}

export function useTranscriptPager(): UseTranscriptPagerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [frozenCount, setFrozenCount] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dumpMode, setDumpMode] = useState(false);

  const open = useCallback((messageCount: number) => {
    setIsOpen(true);
    setFrozenCount(messageCount);
    setDumpMode(false);
    setSearchQuery("");
    setSearchOpen(false);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setFrozenCount(null);
    setDumpMode(false);
    setSearchQuery("");
    setSearchOpen(false);
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  const closeSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setSearchOpen(false);
  }, []);

  const enableDumpMode = useCallback(() => {
    setDumpMode(true);
  }, []);

  return {
    isOpen,
    open,
    close,
    frozenCount,
    searchQuery,
    searchOpen,
    openSearch,
    closeSearch,
    dumpMode,
    enableDumpMode,
  };
}
