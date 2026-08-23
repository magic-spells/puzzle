/*
 * All example data for Mission Control, as plain JS. The runtime's {#for}
 * iterates any array and data() may return any object, so no store/models are
 * needed — this keeps the example focused on the animation system.
 *
 * Every item shares ONE shape so a single ListRow + DetailPanel serve all
 * sections:
 *   { id, name, subtitle, status, statusTone, stats: [{label,value}], tags, summary }
 *   statusTone ∈ 'good' | 'warn' | 'crit' | 'idle'
 */

// --- status tone → Tailwind utility classes --------------------------------
// Kept as full literal strings so Tailwind's content scanner (which reads this
// .js file via the @source glob) generates them. Consumed by ListRow /
// DetailPanel / Overview to color status dots, pills, and event rows.
export const TONE = {
  good: { dot: 'bg-good', text: 'text-good', ring: 'border-good/40 bg-good/10' },
  warn: { dot: 'bg-warn', text: 'text-warn', ring: 'border-warn/40 bg-warn/10' },
  crit: { dot: 'bg-crit', text: 'text-crit', ring: 'border-crit/40 bg-crit/10' },
  idle: { dot: 'bg-idle', text: 'text-idle', ring: 'border-idle/40 bg-idle/10' },
};

export const tone = (t) => TONE[t] || TONE.idle;

// --- Fleet ------------------------------------------------------------------
export const fleet = [
  {
    id: 'odyssey-ii',
    name: 'Odyssey II',
    subtitle: 'Heavy-lift orbiter',
    status: 'Active',
    statusTone: 'good',
    stats: [
      { label: 'Orbit', value: 'Low Earth' },
      { label: 'Crew', value: '4' },
      { label: 'ΔV budget', value: '3.2 km/s' },
      { label: 'Flights', value: '14' },
    ],
    tags: ['Reusable', 'Crewed'],
    summary:
      'Reusable heavy-lift orbiter with 14 flights logged. Assigned to mission Blue Horizon, holding station in low Earth orbit ahead of trans-lunar injection.',
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    subtitle: 'Deep-space probe',
    status: 'En route',
    statusTone: 'warn',
    stats: [
      { label: 'Trajectory', value: 'Heliocentric' },
      { label: 'Range', value: '44.2 AU' },
      { label: 'Signal', value: '6.1 h delay' },
      { label: 'Power', value: 'RTG · 61%' },
    ],
    tags: ['Uncrewed', 'Long-range'],
    summary:
      'Outbound past the heliopause on a decades-long cruise. Instruments nominal; downlink windows scheduled every 40 hours against the deep-space network.',
  },
  {
    id: 'kestrel',
    name: 'Kestrel',
    subtitle: 'Crew shuttle',
    status: 'Docked',
    statusTone: 'idle',
    stats: [
      { label: 'Berth', value: 'Halcyon · Node 3' },
      { label: 'Crew', value: '2' },
      { label: 'ΔV budget', value: '1.4 km/s' },
      { label: 'Consumables', value: '18 days' },
    ],
    tags: ['Crewed', 'Short-hop'],
    summary:
      'Light crew shuttle berthed at the Halcyon platform for turnaround. Next task: ferry the relief crew to Odyssey II before the lunar transfer burn.',
  },
  {
    id: 'meridian',
    name: 'Meridian',
    subtitle: 'Comms relay',
    status: 'Nominal',
    statusTone: 'good',
    stats: [
      { label: 'Orbit', value: 'Geostationary' },
      { label: 'Uptime', value: '99.98%' },
      { label: 'Bandwidth', value: '4.8 Gbit/s' },
      { label: 'Latency', value: '132 ms' },
    ],
    tags: ['Uncrewed', 'Relay'],
    summary:
      'Geostationary relay carrying the primary uplink for the entire fleet. Redundant transponders online; no anomalies logged this quarter.',
  },
  {
    id: 'perseus',
    name: 'Perseus',
    subtitle: 'Cargo hauler',
    status: 'In refit',
    statusTone: 'warn',
    stats: [
      { label: 'Location', value: 'Orbital dock' },
      { label: 'Payload', value: '22 t' },
      { label: 'ΔV budget', value: '2.1 km/s' },
      { label: 'Return', value: 'T+9 days' },
    ],
    tags: ['Uncrewed', 'Cargo'],
    summary:
      'Undergoing engine-cluster refit at the orbital dock. Cleared to resume the Ember Drift resupply run once static-fire checks pass.',
  },
  {
    id: 'halcyon',
    name: 'Halcyon',
    subtitle: 'Science platform',
    status: 'Active',
    statusTone: 'good',
    stats: [
      { label: 'Orbit', value: 'Sun-synchronous' },
      { label: 'Crew', value: '6' },
      { label: 'Modules', value: '9' },
      { label: 'Power', value: 'Solar · 118%' },
    ],
    tags: ['Crewed', 'Station'],
    summary:
      'Permanently crewed research platform running microgravity and Earth-observation experiments. Currently host berth for Kestrel during crew rotation.',
  },
];

// --- Missions ---------------------------------------------------------------
export const missions = [
  {
    id: 'blue-horizon',
    name: 'Blue Horizon',
    subtitle: 'Lunar south-pole survey',
    status: 'Phase 2',
    statusTone: 'good',
    stats: [
      { label: 'Craft', value: 'Odyssey II' },
      { label: 'Crew', value: '4' },
      { label: 'Duration', value: '21 days' },
      { label: 'Launch', value: 'T-06:40' },
    ],
    tags: ['Crewed', 'Lunar'],
    summary:
      'Surface survey of permanently shadowed craters at the lunar south pole, mapping water-ice deposits ahead of a future outpost. Trans-lunar injection pending.',
  },
  {
    id: 'ember-drift',
    name: 'Ember Drift',
    subtitle: 'Asteroid sample return',
    status: 'In cruise',
    statusTone: 'warn',
    stats: [
      { label: 'Target', value: '2049 QC' },
      { label: 'Craft', value: 'Perseus' },
      { label: 'Range', value: '0.8 AU' },
      { label: 'Return', value: '14 months' },
    ],
    tags: ['Uncrewed', 'Sample-return'],
    summary:
      'Rendezvous and touch-and-go sampling of a near-Earth asteroid. In extended cruise while Perseus completes its refit; capture window holds for 40 days.',
  },
  {
    id: 'tidewater',
    name: 'Tidewater',
    subtitle: 'Europa flyby',
    status: 'Planning',
    statusTone: 'idle',
    stats: [
      { label: 'Target', value: 'Europa' },
      { label: 'Craft', value: 'TBD' },
      { label: 'Flybys', value: '11' },
      { label: 'Launch', value: 'Q3 window' },
    ],
    tags: ['Uncrewed', 'Outer-system'],
    summary:
      'Multi-flyby reconnaissance of Europa to characterize its ice shell and plume activity. Trajectory design under review; craft assignment not yet locked.',
  },
  {
    id: 'longwatch',
    name: 'Longwatch',
    subtitle: 'Deep-field telescope deploy',
    status: 'Active',
    statusTone: 'good',
    stats: [
      { label: 'Site', value: 'Sun–Earth L2' },
      { label: 'Craft', value: 'Meridian' },
      { label: 'Aperture', value: '6.5 m' },
      { label: 'First light', value: 'T-02:14' },
    ],
    tags: ['Uncrewed', 'Observatory'],
    summary:
      'Deployment and commissioning of a deep-field infrared telescope at L2. Sunshield fully tensioned; mirror segments in fine-phasing.',
  },
  {
    id: 'redshift',
    name: 'Redshift',
    subtitle: 'Mars relay handover',
    status: 'On hold',
    statusTone: 'crit',
    stats: [
      { label: 'Target', value: 'Mars areostat' },
      { label: 'Craft', value: 'Vanguard' },
      { label: 'Blocker', value: 'Uplink fault' },
      { label: 'Review', value: 'T-11:08' },
    ],
    tags: ['Uncrewed', 'Relay'],
    summary:
      'Handover of the Martian relay constellation stalled after an uplink fault on the ground segment. Board convening to clear the anomaly before resuming.',
  },
  {
    id: 'wayfarer',
    name: 'Wayfarer',
    subtitle: 'Kuiper belt recon',
    status: 'Launch window',
    statusTone: 'warn',
    stats: [
      { label: 'Target', value: 'KBO 486958' },
      { label: 'Craft', value: 'Vanguard-B' },
      { label: 'Cruise', value: '12 years' },
      { label: 'Window', value: '38 days' },
    ],
    tags: ['Uncrewed', 'Long-range'],
    summary:
      'Fast flyby of a cold classical Kuiper belt object. Launch window opens in 38 days; a slip forfeits the gravity assist and adds three years of cruise.',
  },
];

// --- Crew -------------------------------------------------------------------
export const crew = [
  {
    id: 'r-vasquez',
    name: 'Cmdr. Renata Vasquez',
    subtitle: 'Mission Commander',
    status: 'On duty',
    statusTone: 'good',
    stats: [
      { label: 'Assignment', value: 'Odyssey II' },
      { label: 'Hours logged', value: '4,120' },
      { label: 'Missions', value: '6' },
      { label: 'EVA', value: 'Ready' },
    ],
    tags: ['Command', 'EVA-certified'],
    summary:
      'Commander of Blue Horizon aboard Odyssey II. Six flights logged, three as commander. Confirmed EVA readiness for the lunar surface phase.',
  },
  {
    id: 'k-osei',
    name: 'Dr. Kwame Osei',
    subtitle: 'Flight Surgeon',
    status: 'On duty',
    statusTone: 'good',
    stats: [
      { label: 'Assignment', value: 'Halcyon' },
      { label: 'Hours logged', value: '2,880' },
      { label: 'Missions', value: '4' },
      { label: 'Specialty', value: 'Aerospace med' },
    ],
    tags: ['Medical', 'Research'],
    summary:
      'Flight surgeon overseeing crew health across the fleet from the Halcyon platform. Leads the long-duration microgravity countermeasures study.',
  },
  {
    id: 'm-novak',
    name: 'Lt. Mara Novak',
    subtitle: 'Systems Engineer',
    status: 'Rest cycle',
    statusTone: 'idle',
    stats: [
      { label: 'Assignment', value: 'Odyssey II' },
      { label: 'Hours logged', value: '1,540' },
      { label: 'Missions', value: '2' },
      { label: 'Next shift', value: 'T+05:00' },
    ],
    tags: ['Engineering', 'Avionics'],
    summary:
      'Lead systems engineer for Odyssey II avionics. Currently in scheduled rest cycle; returns to console for the pre-injection systems check.',
  },
  {
    id: 's-ito',
    name: 'Sora Ito',
    subtitle: 'Payload Specialist',
    status: 'On duty',
    statusTone: 'good',
    stats: [
      { label: 'Assignment', value: 'Longwatch' },
      { label: 'Hours logged', value: '960' },
      { label: 'Missions', value: '1' },
      { label: 'Focus', value: 'Optics' },
    ],
    tags: ['Science', 'Optics'],
    summary:
      'Payload specialist commissioning the Longwatch telescope optics. Running the fine-phasing sequence on the primary mirror segments.',
  },
  {
    id: 'a-lindqvist',
    name: 'Dr. Anders Lindqvist',
    subtitle: 'Astrophysicist',
    status: 'Ground team',
    statusTone: 'idle',
    stats: [
      { label: 'Assignment', value: 'Mission Control' },
      { label: 'Hours logged', value: '3,400' },
      { label: 'Missions', value: '5' },
      { label: 'Role', value: 'Science lead' },
    ],
    tags: ['Science', 'Ground'],
    summary:
      'Science lead for Longwatch and Tidewater on the ground team. Coordinates observation planning and target selection with the flight crews.',
  },
  {
    id: 'j-bello',
    name: 'Julian Bello',
    subtitle: 'Pilot',
    status: 'Standby',
    statusTone: 'warn',
    stats: [
      { label: 'Assignment', value: 'Kestrel' },
      { label: 'Hours logged', value: '2,010' },
      { label: 'Missions', value: '3' },
      { label: 'Readiness', value: 'Green' },
    ],
    tags: ['Pilot', 'Rendezvous'],
    summary:
      'Pilot on standby for the Kestrel crew-ferry run. Rendezvous and proximity-operations qualified; awaiting the go for undock from Halcyon.',
  },
];

// --- Overview dashboard -----------------------------------------------------
export const overview = {
  stats: [
    { label: 'Active craft', value: '4', hint: 'of 6 in fleet' },
    { label: 'Missions live', value: '3', hint: '2 in cruise' },
    { label: 'Crew on duty', value: '4', hint: '2 resting' },
    { label: 'Uplink', value: '99.98%', hint: 'signal integrity' },
  ],
  feed: [
    { id: 'e1', tone: 'good', text: 'Odyssey II completed orbital-raise burn', time: 'T-02:14' },
    { id: 'e2', tone: 'warn', text: 'Ember Drift entered extended cruise phase', time: 'T-06:40' },
    { id: 'e3', tone: 'crit', text: 'Redshift relay handover placed on hold', time: 'T-11:08' },
    { id: 'e4', tone: 'good', text: 'Cmdr. Vasquez confirmed EVA readiness', time: 'T-18:22' },
    { id: 'e5', tone: 'idle', text: 'Kestrel docked at Halcyon platform', time: 'T-23:55' },
  ],
};
