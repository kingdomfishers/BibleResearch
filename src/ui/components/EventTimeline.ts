// @file: src/ui/components/EventTimeline.ts
// @feature: verse-reader
// @tables: chronology_events | reader_text_events | reader_text_event_links | places
// @candidates: none
// @toc: imports | ui:main | ui:events | logic:load

// === @section:imports ===
import { BibleRPC } from '../../api/rpc';
import type { ActivePassage, ReaderTimeline, VerseGeographyPacket } from '../../api/types';
import { action, el, status, yearLabel } from '../study-dom';
import type { ContextPreview } from './ContextPreview';

// === @section:ui:main ===
export function createEventTimeline(preview: ContextPreview, onPlace: (key: string) => void) {
  const element = el('section', 'passage-context'); element.setAttribute('aria-label', 'Passage time and place');
  const where = el('div', 'context-places'), when = el('div', 'context-time');
  where.append(el('span', 'context-label', 'WHERE'), status('Resolving places…'));
  when.append(el('span', 'context-label', 'WHEN'), status('Loading event context…'));
  element.append(where, when);
  let generation = 0;
  function setGeography(packet: VerseGeographyPacket | null) {
    where.replaceChildren(el('span', 'context-label', 'WHERE'));
    if (!packet || !packet.locations.length) {
      where.append(el('span', 'study-muted', packet?.message ?? 'No established place for this passage')); return;
    }
    for (const place of packet.locations.slice(0, 5)) {
      const button = action(`${place.ancient_name ?? place.biblical_name} ↗`, () => onPlace(place.place_key), 'place-name-link');
      where.append(button);
      const role = place.relationship_type.replaceAll('_', ' ');
      where.append(el('span', 'place-role', `${role}${place.is_inferred ? ' · context' : ''}`));
    }
  }

  // === @section:ui:events ===
  function render(data: ReaderTimeline) {
    when.replaceChildren(el('span', 'context-label', 'WHEN'));
    const summary = el('div', 'time-summary');
    summary.append(el('strong', '', data.events[0]?.era ?? data.summary?.label ?? 'No setting date established'),
      el('span', 'study-muted', `Model: ${data.model_id.replaceAll('-', ' ')}`));
    when.append(summary);
    for (const event of data.events) {
      const entry = el('div', 'timeline-active');
      entry.append(el('strong', '', event.title), el('span', 'timeline-certainty',
        `${event.relationship === 'setting' ? 'Historical setting from superscription' : 'Parallel text'} · exact date unestablished`));
      const lane = el('div', 'timeline-text-lane');
      lane.append(el('span', 'range-label', 'LINKED TEXTS'));
      for (const passage of event.passages) {
        const button = action(passage.label, () => preview.pin(passage, event.reason), 'reference-link');
        preview.attach(button, passage, event.reason); lane.append(button);
      }
      const evidence = el('details', 'timeline-evidence'); evidence.append(el('summary', '', 'Why these passages are connected'));
      evidence.append(el('p', '', event.reason), el('p', 'study-muted', event.source_reference));
      entry.append(lane, evidence); when.append(entry);
    }
    if (!data.events.length && data.published_events.length) {
      for (const event of data.published_events.slice(0, 2)) when.append(el('p', 'timeline-active', `${event.title} · ${yearLabel(event.start_year)} · ${event.relationship}`));
    }
    if (data.neighbors.length) {
      const lane = el('ol', 'timeline-neighbors'); lane.setAttribute('aria-label', 'Nearby dated events in the source model');
      for (const event of [...data.neighbors].sort((a, b) => a.start_year - b.start_year)) {
        const item = el('li'); item.append(el('span', 'timeline-dot'), el('span', '', event.title), el('span', 'study-muted', yearLabel(event.start_year)));
        lane.append(item);
      }
      when.append(el('p', 'range-label', 'NEARBY EVENTS · SOURCE ESTIMATES'), lane);
    }
    if (!data.events.length && !data.published_events.length) when.append(el('p', 'study-muted', 'No reviewed cross-passage event link available.'));
    if (data.events.length && data.summary?.label) when.append(el('p', 'timeline-placement', `Passage placement in selected model: ${data.summary.label}. This does not establish the psalm’s composition date.`));
  }

  // === @section:logic:load ===
  async function load(p: ActivePassage, modelId = 'theographic-verse-v1') {
    const request = ++generation;
    when.replaceChildren(el('span', 'context-label', 'WHEN'), status('Loading event context…'));
    const result = await BibleRPC.getReaderTimeline(p, modelId);
    if (request !== generation) return;
    if (!result.data) {
      when.replaceChildren(el('span', 'context-label', 'WHEN'), status(result.error ?? 'Timeline unavailable.'), action('Retry timeline', () => { void load(p, modelId); })); return;
    }
    render(result.data);
  }
  return { element, load, setGeography, reset: () => {
    generation++; where.replaceChildren(el('span', 'context-label', 'WHERE'), status('Resolving places…'));
  } };
}
