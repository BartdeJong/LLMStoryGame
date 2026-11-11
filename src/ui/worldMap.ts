import "./worldMap.css";
import type { Area, AreaDoor } from "../world/types";
import { activateGamepadFocus } from "../input/focus";

const SVG_NS = "http://www.w3.org/2000/svg";
const CARD_WIDTH = 230;
const HEADER_HEIGHT = 46;
const EXIT_HEIGHT = 24;
const LOCK_NOTE_HEIGHT = 16;
const PEOPLE_HEIGHT = 22;
const CARD_FOOT = 6;
const COLUMN_GAP = 72;
const ROW_GAP = 36;
const MAP_MARGIN = 40;
const ARROW_STEP = 22.5;
const DEFAULT_HINT = "Arrows show which side of a place each exit is on (↑ is north). Choose a place to see the way there. Press M or Escape to return.";

export type ExitSide =
  | "north" | "north-east" | "east" | "south-east"
  | "south" | "south-west" | "west" | "north-west";

export interface WorldMapCell {
  readonly column: number;
  readonly row: number;
}

// What the map cannot read from the areas themselves. Every part is optional.
export interface WorldMapDetails {
  // The fixed compass cell of an area. When every explored area has one, the map shows them where they really are.
  getCell?(areaId: string): WorldMapCell | undefined;
  // A few words on why an exit cannot be used yet, or null when it is open.
  getExitLock?(areaId: string, doorId: string): string | null;
  // People the player has already talked to in an area.
  getPeopleMet?(areaId: string): readonly string[];
  // Whether a place belongs to the lead the player is following; also asked for places that are not explored yet.
  isLead?(areaId: string): boolean;
}

export interface WorldMapExit {
  readonly door: AreaDoor;
  readonly side: ExitSide;
  // Direction of the door seen from the middle of its area: clockwise degrees from north, in steps of 22.5.
  readonly bearing: number;
  // Set only when the door leads to an explored area.
  readonly targetAreaId?: string;
  readonly lock?: string;
  // The door leads to a place of the current lead that has not been explored yet.
  readonly lead: boolean;
}

export interface WorldMapNode {
  readonly area: Area;
  readonly column: number;
  readonly row: number;
  readonly exits: readonly WorldMapExit[];
  readonly peopleMet: readonly string[];
  readonly lead: boolean;
}

export interface WorldMapEdge {
  readonly from: string;
  readonly to: string;
  readonly fromDoorId: string;
  // The door in `to` that leads back to `from`, when there is one.
  readonly toDoorId?: string;
}

export interface WorldMapGraph {
  readonly nodes: readonly WorldMapNode[];
  readonly edges: readonly WorldMapEdge[];
}

export interface WorldMapCard {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldMapLayout {
  readonly width: number;
  readonly height: number;
  readonly cards: ReadonlyMap<string, WorldMapCard>;
  // Heights of the card-free strips above, between and below the rows.
  readonly lanes: readonly number[];
}

export interface WorldMapPoint {
  readonly x: number;
  readonly y: number;
}

// A path between two exits: one direct curve, or a detour whose corners all lie in the gaps between cards.
export interface WorldMapRoute {
  readonly start: WorldMapPoint;
  readonly end: WorldMapPoint;
  readonly curve?: readonly [WorldMapPoint, WorldMapPoint];
  readonly corners?: readonly WorldMapPoint[];
}

// One leg of the way to a chosen place: leave `areaId` through `doorId` to reach `targetAreaId`.
export interface WorldMapStep {
  readonly areaId: string;
  readonly doorId: string;
  readonly targetAreaId: string;
}

export interface WorldMap {
  readonly isOpen: boolean;
  toggle(): void;
  close(): void;
  remove(): void;
}

function doorOffset(area: Area, door: AreaDoor): { dx: number; dy: number } {
  return {
    dx: (door.x - (area.width - 1) / 2) / Math.max(1, (area.width - 1) / 2),
    dy: (door.y - (area.height - 1) / 2) / Math.max(1, (area.height - 1) / 2),
  };
}

// Which side of its area a door sits on. Doors near a corner get a diagonal so two doors on one wall stay distinct.
export function exitSide(area: Area, door: AreaDoor): ExitSide {
  const { dx, dy } = doorOffset(area, door);
  const horizontal = Math.abs(dx) > 0.5 ? (dx < 0 ? "west" : "east") : "";
  const vertical = Math.abs(dy) > 0.5 ? (dy < 0 ? "north" : "south") : "";
  if (horizontal && vertical) return `${vertical}-${horizontal}` as ExitSide;
  if (horizontal || vertical) return (horizontal || vertical) as ExitSide;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "west" : "east";
  return dy < 0 ? "north" : "south";
}

// The finer direction used for the arrow, so that several doors on one wall still point different ways.
export function exitBearing(area: Area, door: AreaDoor): number {
  const { dx, dy } = doorOffset(area, door);
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return (Math.round(degrees / ARROW_STEP) * ARROW_STEP) % 360;
}

// Places every explored area on a grid. With fixed cells the areas keep their real compass positions; empty rows and
// columns are closed up. Without them the areas are laid out from the first explored one, following their doors,
// so the picture stays the same wherever the player is standing.
function placeAreas(areas: readonly Area[], details: WorldMapDetails): Map<string, WorldMapCell> {
  const cells = areas.map((area) => details.getCell?.(area.id));
  if (cells.every((cell): cell is WorldMapCell => cell !== undefined)
    && new Set(cells.map(({ column, row }) => `${column},${row}`)).size === cells.length) {
    const columns = [...new Set(cells.map(({ column }) => column))].sort((a, b) => a - b);
    const rows = [...new Set(cells.map(({ row }) => row))].sort((a, b) => a - b);
    return new Map(areas.map((area, index) => [area.id, {
      column: columns.indexOf(cells[index]!.column),
      row: rows.indexOf(cells[index]!.row),
    }]));
  }

  const areasById = new Map(areas.map((area) => [area.id, area]));
  const positions = new Map<string, WorldMapCell>();
  const occupied = new Set<string>();
  const positionKey = (column: number, row: number): string => `${column},${row}`;
  const placeComponent = (startId: string, start: WorldMapCell): void => {
    positions.set(startId, start);
    occupied.add(positionKey(start.column, start.row));
    const queue = [startId];
    for (let index = 0; index < queue.length; index += 1) {
      const areaId = queue[index]!;
      const area = areasById.get(areaId)!;
      const position = positions.get(areaId)!;
      for (const door of area.doors) {
        const targetId = door.targetAreaId;
        if (!targetId || !areasById.has(targetId) || positions.has(targetId)) continue;
        const dx = door.x - (area.width - 1) / 2;
        const dy = door.y - (area.height - 1) / 2;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const direction = horizontal
          ? { column: dx < 0 ? -1 : 1, row: 0 }
          : { column: 0, row: dy < 0 ? -1 : 1 };
        let candidate: WorldMapCell | undefined;
        for (let distance = 1; !candidate; distance += 1) {
          for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
            const column = position.column + direction.column * distance + (horizontal ? 0 : offset);
            const row = position.row + direction.row * distance + (horizontal ? offset : 0);
            if (!occupied.has(positionKey(column, row))) {
              candidate = { column, row };
              break;
            }
          }
        }
        positions.set(targetId, candidate);
        occupied.add(positionKey(candidate.column, candidate.row));
        queue.push(targetId);
      }
    }
  };

  for (const area of areas) {
    if (positions.has(area.id)) continue;
    if (positions.size === 0) {
      placeComponent(area.id, { column: 0, row: 0 });
      continue;
    }
    const maxColumn = Math.max(...[...positions.values()].map(({ column }) => column));
    let startColumn = maxColumn + 2;
    while (occupied.has(positionKey(startColumn, 0))) startColumn += 1;
    placeComponent(area.id, { column: startColumn, row: 0 });
  }

  const minColumn = Math.min(...[...positions.values()].map(({ column }) => column));
  const minRow = Math.min(...[...positions.values()].map(({ row }) => row));
  return new Map([...positions].map(([id, { column, row }]) => [id, { column: column - minColumn, row: row - minRow }]));
}

export function buildWorldMapGraph(
  areas: readonly Area[],
  currentAreaId: string,
  details: WorldMapDetails = {},
): WorldMapGraph {
  const areasById = new Map(areas.map((area) => [area.id, area]));
  if (!areasById.has(currentAreaId)) {
    throw new Error(`The current area "${currentAreaId}" is missing from the explored map.`);
  }

  const positions = placeAreas(areas, details);
  const nodes = areas.map((area): WorldMapNode => ({
    area,
    ...positions.get(area.id)!,
    exits: area.doors.map((door): WorldMapExit => {
      const explored = door.targetAreaId !== undefined && areasById.has(door.targetAreaId);
      const lock = details.getExitLock?.(area.id, door.id) ?? undefined;
      return {
        door,
        side: exitSide(area, door),
        bearing: exitBearing(area, door),
        ...(explored ? { targetAreaId: door.targetAreaId } : {}),
        ...(lock ? { lock } : {}),
        lead: !explored && door.targetAreaId !== undefined && details.isLead?.(door.targetAreaId) === true,
      };
    }),
    peopleMet: details.getPeopleMet?.(area.id) ?? [],
    lead: details.isLead?.(area.id) === true,
  }));

  const edges: WorldMapEdge[] = [];
  const seenEdges = new Set<string>();
  for (const area of areas) {
    for (const door of area.doors) {
      const targetId = door.targetAreaId;
      if (!targetId || !areasById.has(targetId) || targetId === area.id) continue;
      const returnDoor = areasById.get(targetId)!.doors.find((candidate) => candidate.targetAreaId === area.id);
      const key = [`${area.id}\u0000${door.id}`, `${targetId}\u0000${returnDoor?.id ?? ""}`].sort().join("\u0001");
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({
        from: area.id,
        to: targetId,
        fromDoorId: door.id,
        ...(returnDoor ? { toDoorId: returnDoor.id } : {}),
      });
    }
  }

  return { nodes, edges };
}

// The shortest chain of open, explored exits from one place to another. Empty when both are the same place,
// null when no such chain exists.
export function findWorldMapRoute(graph: WorldMapGraph, fromAreaId: string, toAreaId: string): WorldMapStep[] | null {
  const nodesById = new Map(graph.nodes.map((node) => [node.area.id, node]));
  if (!nodesById.has(fromAreaId) || !nodesById.has(toAreaId)) return null;
  const arrivedBy = new Map<string, WorldMapStep | null>([[fromAreaId, null]]);
  const queue = [fromAreaId];
  for (let index = 0; index < queue.length && !arrivedBy.has(toAreaId); index += 1) {
    const areaId = queue[index]!;
    for (const exit of nodesById.get(areaId)!.exits) {
      if (exit.targetAreaId === undefined || exit.lock !== undefined || arrivedBy.has(exit.targetAreaId)) continue;
      arrivedBy.set(exit.targetAreaId, { areaId, doorId: exit.door.id, targetAreaId: exit.targetAreaId });
      queue.push(exit.targetAreaId);
    }
  }
  if (!arrivedBy.has(toAreaId)) return null;
  const steps: WorldMapStep[] = [];
  for (let step = arrivedBy.get(toAreaId); step; step = arrivedBy.get(step.areaId)) steps.unshift(step);
  return steps;
}

function exitHeight(exit: WorldMapExit): number {
  return EXIT_HEIGHT + (exit.lock ? LOCK_NOTE_HEIGHT : 0);
}

// Cards list one exit per line, so their height varies; each grid row is as tall as its tallest card.
export function layoutWorldMap(graph: WorldMapGraph): WorldMapLayout {
  const cardHeight = (node: WorldMapNode): number => HEADER_HEIGHT
    + node.exits.reduce((sum, exit) => sum + exitHeight(exit), 0)
    + (node.peopleMet.length > 0 ? PEOPLE_HEIGHT : 0)
    + CARD_FOOT;
  const columnCount = Math.max(...graph.nodes.map((node) => node.column)) + 1;
  const rowHeights = new Array<number>(Math.max(...graph.nodes.map((node) => node.row)) + 1).fill(HEADER_HEIGHT + CARD_FOOT);
  for (const node of graph.nodes) rowHeights[node.row] = Math.max(rowHeights[node.row]!, cardHeight(node));
  const rowTops: number[] = [];
  let nextTop = MAP_MARGIN;
  for (const height of rowHeights) {
    rowTops.push(nextTop);
    nextTop += height + ROW_GAP;
  }
  const cards = new Map(graph.nodes.map((node) => [node.area.id, {
    x: MAP_MARGIN + node.column * (CARD_WIDTH + COLUMN_GAP),
    y: rowTops[node.row]!,
    width: CARD_WIDTH,
    height: cardHeight(node),
  }]));
  const height = nextTop - ROW_GAP + MAP_MARGIN;
  return {
    width: MAP_MARGIN * 2 + columnCount * CARD_WIDTH + (columnCount - 1) * COLUMN_GAP,
    height,
    cards,
    lanes: [MAP_MARGIN / 2, ...rowTops.slice(1).map((top) => top - ROW_GAP / 2), height - MAP_MARGIN / 2],
  };
}

// Vertical middle of an exit's line on its card; a missing door falls back to the card header.
function exitY(node: WorldMapNode, card: WorldMapCard, doorId: string | undefined): number {
  const index = doorId === undefined ? -1 : node.exits.findIndex((exit) => exit.door.id === doorId);
  if (index < 0) return card.y + HEADER_HEIGHT / 2;
  const above = node.exits.slice(0, index).reduce((sum, exit) => sum + exitHeight(exit), 0);
  return card.y + HEADER_HEIGHT + above + EXIT_HEIGHT / 2;
}

function curvePoint(route: WorldMapRoute, t: number): WorldMapPoint {
  const [first, second] = route.curve!;
  const u = 1 - t;
  const at = (a: number, b: number, c: number, d: number): number =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return { x: at(route.start.x, first.x, second.x, route.end.x), y: at(route.start.y, first.y, second.y, route.end.y) };
}

// One route per edge, in edge order. A path that would run behind another card is sent around through the gaps,
// because a line that disappears behind a card looks like a connection to it.
export function routeWorldMapEdges(graph: WorldMapGraph, layout: WorldMapLayout): WorldMapRoute[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.area.id, node]));
  const cards = [...layout.cards.values()];
  let detours = 0;
  return graph.edges.map((edge): WorldMapRoute => {
    const from = nodesById.get(edge.from)!;
    const to = nodesById.get(edge.to)!;
    const fromCard = layout.cards.get(edge.from)!;
    const toCard = layout.cards.get(edge.to)!;
    const fromY = exitY(from, fromCard, edge.fromDoorId);
    const toY = exitY(to, toCard, edge.toDoorId);
    if (from.column === to.column) {
      // Stacked places: loop around the side of the column, which stays inside the gap next to it.
      // The side alternates from row to row, so the loops above and below a card do not pile up in one gap.
      const side = Math.min(from.row, to.row) % 2 === 0 ? 1 : -1;
      const x = side > 0 ? fromCard.x + fromCard.width : fromCard.x;
      const bulge = side * Math.min(48, 34 + 8 * Math.abs(from.row - to.row));
      return {
        start: { x, y: fromY },
        end: { x, y: toY },
        curve: [{ x: x + bulge, y: fromY }, { x: x + bulge, y: toY }],
      };
    }
    const direction = from.column < to.column ? 1 : -1;
    const start = { x: direction > 0 ? fromCard.x + fromCard.width : fromCard.x, y: fromY };
    const end = { x: direction > 0 ? toCard.x : toCard.x + toCard.width, y: toY };
    const bend = Math.max(28, Math.abs(end.x - start.x) / 2) * direction;
    const direct: WorldMapRoute = {
      start,
      end,
      curve: [{ x: start.x + bend, y: fromY }, { x: end.x - bend, y: toY }],
    };
    const blocked = Array.from({ length: 63 }, (_, index) => curvePoint(direct, (index + 1) / 64)).some((point) =>
      cards.some((card) => point.x > card.x && point.x < card.x + card.width
        && point.y > card.y && point.y < card.y + card.height));
    if (!blocked) return direct;
    // Detours are spread over a few tracks so that neighbouring ones do not hide each other.
    const shift = ((detours % 5) - 2) * 5;
    detours += 1;
    const lane = layout.lanes.reduce((best, candidate) =>
      Math.abs(fromY - candidate) + Math.abs(toY - candidate) < Math.abs(fromY - best) + Math.abs(toY - best)
        ? candidate : best) + shift;
    const leave = start.x + direction * (COLUMN_GAP / 2 + shift);
    const arrive = end.x - direction * (COLUMN_GAP / 2 + shift);
    return {
      start,
      end,
      corners: [{ x: leave, y: fromY }, { x: leave, y: lane }, { x: arrive, y: lane }, { x: arrive, y: toY }],
    };
  });
}

function routePath(route: WorldMapRoute): string {
  const { start, end } = route;
  if (route.curve) {
    const [first, second] = route.curve;
    return `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`;
  }
  const points = [start, ...(route.corners ?? []), end];
  let d = `M ${start.x} ${start.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(10, before / 2, after / 2);
    if (radius <= 0) continue;
    const enterX = corner.x - ((corner.x - previous.x) / before) * radius;
    const enterY = corner.y - ((corner.y - previous.y) / before) * radius;
    const leaveX = corner.x + ((next.x - corner.x) / after) * radius;
    const leaveY = corner.y + ((next.y - corner.y) / after) * radius;
    d += ` L ${enterX} ${enterY} Q ${corner.x} ${corner.y} ${leaveX} ${leaveY}`;
  }
  return `${d} L ${end.x} ${end.y}`;
}

function svgElement(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag);
}

function sideName(side: ExitSide): string {
  return side.replace("-", " ");
}

// Arrows are drawn rather than typed because diagonal arrow characters render as emoji on some devices.
function bearingArrow(bearing: number): SVGElement {
  const icon = svgElement("svg");
  icon.classList.add("world-map-exit-side");
  icon.setAttribute("viewBox", "0 0 18 18");
  icon.setAttribute("aria-hidden", "true");
  const arrow = svgElement("path");
  arrow.setAttribute("d", "M9 14 V4.5 M5 8.5 L9 4.5 L13 8.5");
  arrow.setAttribute("transform", `rotate(${bearing} 9 9)`);
  icon.append(arrow);
  return icon;
}

function tag(text: string, kind: "lead" | "locked" | "note"): HTMLElement {
  const element = document.createElement("span");
  element.className = `world-map-tag world-map-tag-${kind}`;
  element.textContent = text;
  return element;
}

interface RenderedMap {
  readonly graph: WorldMapGraph;
  readonly layout: WorldMapLayout;
  readonly cards: ReadonlyMap<string, { readonly card: HTMLElement; readonly button: HTMLButtonElement }>;
  // Exit lines by area id and door id.
  readonly exits: ReadonlyMap<string, HTMLElement>;
  readonly paths: readonly { readonly edge: WorldMapEdge; readonly group: SVGElement }[];
}

export function createWorldMap(
  container: HTMLElement,
  getAreas: () => readonly Area[],
  getCurrentAreaId: () => string,
  details: WorldMapDetails = {},
): WorldMap {
  const overlay = document.createElement("section");
  overlay.className = "world-map";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "world-map-title");

  const header = document.createElement("header");
  header.className = "world-map-header";
  const title = document.createElement("h2");
  title.id = "world-map-title";
  title.textContent = "Explored places";
  const centerButton = document.createElement("button");
  centerButton.className = "world-map-close";
  centerButton.type = "button";
  centerButton.textContent = "Center on me";
  const closeButton = document.createElement("button");
  closeButton.className = "world-map-close";
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => close());
  header.append(title, centerButton, closeButton);

  const viewport = document.createElement("div");
  viewport.className = "world-map-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "Map of explored places and their exits");
  const diagram = document.createElement("div");
  diagram.className = "world-map-diagram";
  const svg = svgElement("svg");
  svg.classList.add("world-map-paths");
  svg.setAttribute("aria-hidden", "true");
  const cardList = document.createElement("div");
  cardList.className = "world-map-cards";
  diagram.append(svg, cardList);
  viewport.append(diagram);
  const hint = document.createElement("p");
  hint.className = "world-map-hint";
  hint.setAttribute("aria-live", "polite");
  hint.textContent = DEFAULT_HINT;
  overlay.append(header, viewport, hint);
  container.append(overlay);

  let open = false;
  let rendered: RenderedMap | null = null;
  // The place the player asked the way to. It is kept while the map is closed, so the way can be checked again later.
  let destinationId: string | null = null;
  let returnFocus: HTMLElement | null = null;
  const exitKey = (areaId: string, doorId: string | undefined): string => `${areaId}\u0000${doorId ?? ""}`;
  const centerCurrent = (): void => {
    const current = rendered?.layout.cards.get(getCurrentAreaId());
    if (!current) return;
    viewport.scrollLeft = Math.max(0, current.x + current.width / 2 - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, current.y + current.height / 2 - viewport.clientHeight / 2);
  };
  centerButton.addEventListener("click", centerCurrent);

  // Marks the way to the chosen place on the cards and paths that are already on screen.
  const showWay = (): void => {
    if (!rendered) return;
    const { graph, cards, exits, paths } = rendered;
    const currentAreaId = getCurrentAreaId();
    if (destinationId !== null && (destinationId === currentAreaId || !cards.has(destinationId))) destinationId = null;
    const steps = destinationId === null ? null : findWorldMapRoute(graph, currentAreaId, destinationId);
    const nodesById = new Map(graph.nodes.map((node) => [node.area.id, node]));

    for (const line of exits.values()) {
      line.classList.remove("world-map-exit-way");
      line.querySelector(".world-map-exit-step")?.remove();
    }
    for (const [areaId, { card, button }] of cards) {
      card.classList.toggle("world-map-card-destination", areaId === destinationId);
      button.setAttribute("aria-pressed", String(areaId === destinationId));
    }
    for (const { edge, group } of paths) {
      group.classList.remove("world-map-path-way");
      // Without a chosen place, the paths of the current place stand out instead.
      group.classList.toggle("world-map-path-current",
        destinationId === null && (edge.from === currentAreaId || edge.to === currentAreaId));
    }
    for (const { group } of paths) {
      if (group.classList.contains("world-map-path-current")) svg.append(group);
    }
    if (destinationId === null) {
      hint.textContent = DEFAULT_HINT;
      return;
    }
    const destination = nodesById.get(destinationId)!.area.name;
    if (!steps) {
      hint.textContent = `There is no open way to ${destination} from here yet.`;
      return;
    }
    steps.forEach((step, index) => {
      const line = exits.get(exitKey(step.areaId, step.doorId));
      if (line) {
        line.classList.add("world-map-exit-way");
        const number = document.createElement("span");
        number.className = "world-map-exit-step";
        number.textContent = String(index + 1);
        line.append(number);
      }
      const path = paths.find(({ edge }) =>
        (edge.from === step.areaId && edge.fromDoorId === step.doorId)
        || (edge.to === step.areaId && edge.toDoorId === step.doorId));
      if (path) {
        path.group.classList.add("world-map-path-way");
        svg.append(path.group);
      }
    });
    const first = steps[0]!;
    const firstSide = sideName(nodesById.get(first.areaId)!.exits.find((exit) => exit.door.id === first.doorId)!.side);
    hint.textContent = steps.length === 1
      ? `Way to ${destination}: take the ${firstSide} exit.`
      : `Way to ${destination}: ${steps.length} exits, starting with the ${firstSide} exit to ${nodesById.get(first.targetAreaId)!.area.name}. Follow the numbers.`;
  };

  const render = (): void => {
    const currentAreaId = getCurrentAreaId();
    const graph = buildWorldMapGraph(getAreas(), currentAreaId, details);
    const layout = layoutWorldMap(graph);
    diagram.style.width = `${layout.width}px`;
    diagram.style.height = `${layout.height}px`;
    svg.replaceChildren();
    cardList.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    svg.setAttribute("width", String(layout.width));
    svg.setAttribute("height", String(layout.height));
    title.textContent = `Explored places · ${graph.nodes.length}`;

    const nodesById = new Map(graph.nodes.map((node) => [node.area.id, node]));
    const exitDescription = (node: WorldMapNode, doorId: string | undefined): string => {
      const exit = node.exits.find((candidate) => candidate.door.id === doorId);
      return exit ? `${node.area.name} (${sideName(exit.side)} exit)` : node.area.name;
    };
    const routes = routeWorldMapEdges(graph, layout);
    const paths = graph.edges.map((edge, index) => {
      const route = routes[index]!;
      const group = svgElement("g");
      group.classList.add("world-map-path");
      const path = svgElement("path");
      path.setAttribute("d", routePath(route));
      const pathTitle = svgElement("title");
      pathTitle.textContent = `${exitDescription(nodesById.get(edge.from)!, edge.fromDoorId)} ↔ ${exitDescription(nodesById.get(edge.to)!, edge.toDoorId)}`;
      path.append(pathTitle);
      group.append(path);
      for (const point of [route.start, route.end]) {
        const port = svgElement("circle");
        port.setAttribute("cx", String(point.x));
        port.setAttribute("cy", String(point.y));
        port.setAttribute("r", "4");
        group.append(port);
      }
      svg.append(group);
      return { edge, group };
    });

    const cards = new Map<string, { card: HTMLElement; button: HTMLButtonElement }>();
    const exits = new Map<string, HTMLElement>();
    for (const node of graph.nodes) {
      const rect = layout.cards.get(node.area.id)!;
      const current = node.area.id === currentAreaId;
      const card = document.createElement("article");
      card.className = current ? "world-map-card world-map-card-current" : "world-map-card";
      card.style.left = `${rect.x}px`;
      card.style.top = `${rect.y}px`;
      card.style.width = `${rect.width}px`;
      card.style.height = `${rect.height}px`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "world-map-card-header";
      button.style.height = `${HEADER_HEIGHT}px`;
      button.title = current ? "You are here" : `Show the way to ${node.area.name}`;
      button.setAttribute("aria-pressed", "false");
      const heading = document.createElement("span");
      heading.className = "world-map-card-title";
      const name = document.createElement("span");
      name.className = "world-map-card-name";
      name.textContent = node.area.name;
      heading.append(name);
      if (node.lead) heading.append(tag("Lead", "lead"));
      const biome = document.createElement("span");
      biome.className = "world-map-card-biome";
      biome.textContent = current ? `${node.area.biome} · YOU ARE HERE` : node.area.biome;
      button.append(heading, biome);
      button.addEventListener("click", () => {
        destinationId = current || destinationId === node.area.id ? null : node.area.id;
        showWay();
      });

      const exitList = document.createElement("ul");
      exitList.className = "world-map-exits";
      for (const exit of node.exits) {
        const target = exit.targetAreaId === undefined ? undefined : nodesById.get(exit.targetAreaId);
        const item = document.createElement("li");
        item.className = "world-map-exit";
        if (!target) item.classList.add("world-map-exit-unexplored");
        const description = [
          `${sideName(exit.side)} exit`,
          exit.door.label,
          target ? `leads to ${target.area.name}` : "not explored yet",
          ...(exit.lead ? ["part of your current lead"] : []),
          ...(exit.lock ? [`locked: ${exit.lock}`] : []),
        ].join(", ");
        item.title = `${description.charAt(0).toUpperCase()}${description.slice(1)}`;
        item.setAttribute("aria-label", item.title);
        const line = document.createElement("div");
        line.className = "world-map-exit-line";
        line.style.height = `${EXIT_HEIGHT}px`;
        const destination = document.createElement("span");
        destination.className = "world-map-exit-target";
        destination.textContent = target ? target.area.name : exit.door.label;
        line.append(bearingArrow(exit.bearing), destination);
        if (exit.lead) line.append(tag("Lead", "lead"));
        if (exit.lock) line.append(tag("Locked", "locked"));
        else if (!target && !exit.lead) line.append(tag("Unexplored", "note"));
        item.append(line);
        if (exit.lock) {
          const note = document.createElement("p");
          note.className = "world-map-exit-lock";
          note.style.height = `${LOCK_NOTE_HEIGHT}px`;
          note.textContent = exit.lock;
          item.append(note);
        }
        exits.set(exitKey(node.area.id, exit.door.id), line);
        exitList.append(item);
      }
      card.append(button, exitList);
      if (node.peopleMet.length > 0) {
        const people = document.createElement("p");
        people.className = "world-map-card-people";
        people.style.height = `${PEOPLE_HEIGHT}px`;
        people.textContent = `Met: ${node.peopleMet.join(", ")}`;
        people.title = people.textContent;
        card.append(people);
      }
      cards.set(node.area.id, { card, button });
      cardList.append(card);
    }
    rendered = { graph, layout, cards, exits, paths };
    showWay();
  };

  const close = (): void => {
    open = false;
    overlay.hidden = true;
    // Keyboard movement ignores keys aimed at buttons, so a focused button would swallow it until a click.
    if (returnFocus?.isConnected && !returnFocus.closest("button, a[href]")) returnFocus.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    returnFocus = null;
  };
  const stopGamepadFocus = activateGamepadFocus(overlay, {
    isActive: () => open,
    onBack: close,
  });

  return {
    get isOpen(): boolean {
      return open;
    },
    toggle(): void {
      if (open) {
        close();
        return;
      }
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render();
      open = true;
      overlay.hidden = false;
      centerCurrent();
      closeButton.focus();
    },
    close,
    remove(): void {
      close();
      stopGamepadFocus();
      overlay.remove();
    },
  };
}
