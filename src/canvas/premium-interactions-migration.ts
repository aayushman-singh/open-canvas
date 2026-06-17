import type { CanvasSection, EditableSite, InteractionTrigger, Overlay } from './schema.js';

function triggerToInteraction(trigger: NonNullable<CanvasSection['trigger']>): InteractionTrigger {
  if (trigger.type === 'exit-intent') return { type: 'exit-intent' };
  if (trigger.type === 'delay') return { type: 'delay', value: trigger.value };
  return { type: 'scroll', value: trigger.value };
}

function defaultDismissal(): Overlay['dismissal'] {
  return {
    closeButton: true,
    escape: true,
    backdropClick: true,
    bodyScrollLock: true,
    focusTrap: true,
    returnFocus: true,
  };
}

function sectionWithoutTrigger(section: CanvasSection): CanvasSection {
  const { trigger: _trigger, ...rest } = section;
  void _trigger;
  return { ...rest };
}

export function migratePopupTriggersToOverlays(site: EditableSite): {
  site: EditableSite;
  changed: boolean;
} {
  const overlays: Overlay[] = [...(site.overlays ?? [])];
  let changed = false;
  const pages = site.pages.map((page) => {
    const nextSections: CanvasSection[] = [];
    let pageChanged = false;
    for (const section of page.sections) {
      if (!section.trigger) {
        nextSections.push(section);
        continue;
      }
      changed = true;
      pageChanged = true;
      overlays.push({
        id: `overlay-${section.id}`,
        name: section.name || 'Overlay',
        scope: { type: 'pages', pageIds: [page.id] },
        trigger: triggerToInteraction(section.trigger),
        content: sectionWithoutTrigger(section),
        dismissal: defaultDismissal(),
      });
    }
    return pageChanged ? { ...page, sections: nextSections } : page;
  });
  if (!changed) return { site, changed: false };
  return {
    site: {
      ...site,
      pages,
      overlays,
    },
    changed: true,
  };
}
