import { useEffect } from 'react';
import type {WebContentSendPayload} from "../menu/channels"
export function useMenuListener(callback: (data: WebContentSendPayload)=>void) {
  useEffect(() => {
    window.electron.menuOn(callback);
    return () => {
        window.electron.menuOff(callback);
      };
  }, []);
}
