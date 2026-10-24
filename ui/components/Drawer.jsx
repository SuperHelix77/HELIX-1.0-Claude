import React, {useEffect, useRef} from 'react';
import {X} from 'lucide-react';

// Native modal dialog: focus is trapped, Escape closes, focus returns to the opener.
export default function Drawer({open, title, onClose, children}) {
  const ref = useRef(null);
  const opener = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { opener.current = document.activeElement; dialog.showModal(); }
    if (!open && dialog.open) { dialog.close(); opener.current?.focus?.(); }
  }, [open]);
  return <dialog ref={ref} className="drawer" aria-labelledby="drawer-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) onClose(); }}>
    {open && <><div className="drawer-head"><h2 id="drawer-title">{title}</h2><button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}><X size={18} /></button></div>
      <div className="drawer-body">{children}</div></>}
  </dialog>;
}
