import {
  appendChild,
  find,
  findAll,
  getAttr,
  getText,
  remove,
  setAttr,
  setText,
  type PathSegment,
  type XmlElement,
} from "./model";
import { parseXml, type ParsedXml } from "./parse";
import { serializeXml } from "./serialize";

/**
 * An .ibmaps XML document held as a preserved-order tree. All edits are
 * patches on this tree; serialization reproduces the original formatting.
 */
export class XmlDocument {
  private constructor(private readonly parsed: ParsedXml) {}

  static parse(xml: string): XmlDocument {
    return new XmlDocument(parseXml(xml));
  }

  get root(): XmlElement {
    return this.parsed.root;
  }

  serialize(): string {
    return serializeXml(this.parsed);
  }

  find(path: PathSegment[]): XmlElement | undefined {
    return find(this.parsed.root, path);
  }

  findAll(path: PathSegment[]): XmlElement[] {
    return findAll(this.parsed.root, path);
  }

  getText(path: PathSegment[]): string | undefined {
    const el = this.find(path);
    return el ? getText(el) : undefined;
  }

  setText(path: PathSegment[], value: string): void {
    const el = this.mustFind(path);
    setText(el, value);
  }

  getAttr(path: PathSegment[], name: string): string | undefined {
    const el = this.find(path);
    return el ? getAttr(el, name) : undefined;
  }

  setAttr(path: PathSegment[], name: string, value: string): void {
    const el = this.mustFind(path);
    setAttr(el, name, value);
  }

  appendChild(path: PathSegment[], child: XmlElement): void {
    const el = this.mustFind(path);
    appendChild(el, child);
  }

  remove(path: PathSegment[]): boolean {
    const el = this.find(path);
    return el ? remove(el) : false;
  }

  private mustFind(path: PathSegment[]): XmlElement {
    const el = this.find(path);
    if (!el) {
      throw new Error(`No XML element at path ${JSON.stringify(path)}`);
    }
    return el;
  }
}
