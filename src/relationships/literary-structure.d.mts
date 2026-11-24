/** Evidence-bearing ordered events; single edition per invocation. */
export interface LiteraryEvent {
  id: string;
  key: string;
  wordIds: string[];
  features: string[];
}
export interface AlignmentPair { a: number|null; b: number|null; similarity: number }
export interface LiteraryDeviation {
  kind: 'omission'|'addition'|'substitution'|'feature_addition';
  unit: number; column: number; expected: string|null; observed: string|null;
  peerSupport: number; peerCount: number; surprisalBits: number;
  witnessIds: string[]; beforeId?: string|null; afterId?: string|null;
}
export interface LiteraryTemplate {
  unitEventIds: string[][];
  columns: { index:number; key:string; support:number; eventIds:(string|null)[]; alternatives:string[] }[];
  deviations: LiteraryDeviation[];
  compressionProxy: number;
}
export interface DiscoveredTemplate extends LiteraryTemplate {
  anchorKeys:string[]; anchorSide:'start'|'end'; coverage:number; score:number; unassignedEventIds:string[];
}
export function alignSequences(a:LiteraryEvent[],b:LiteraryEvent[],local?:boolean): {score:number;pairs:AlignmentPair[]};
export function induceTemplate(units:LiteraryEvent[][]): LiteraryTemplate;
export function repeatedPhrases(events:LiteraryEvent[],options?:{maxLen?:number;limit?:number}): {keys:string[];starts:number[];occurrences:string[][];score:number}[];
export function discoverTemplates(events:LiteraryEvent[],options?:{limit?:number}): DiscoveredTemplate[];
export function discoverChiasms(events:LiteraryEvent[],options?:{maxArm?:number;limit?:number}): {kind:'candidate_literary_pattern';start:number;endExclusive:number;pairs:{leftId:string;rightId:string;similarity:number}[];centerIds:string[];reverseMean:number;forwardMean:number;score:number}[];
