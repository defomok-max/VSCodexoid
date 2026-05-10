import type { SkillDefinition } from "../../shared/types";

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  registerMany(list: SkillDefinition[]): void {
    for (const s of list) this.register(s);
  }

  unregister(id: string): boolean {
    return this.skills.delete(id);
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  /**
   * Picks skills whose triggers match a chat message. Triggers are lowercase
   * substrings; a skill matches when any of its triggers is present in the
   * message after lower-casing.
   */
  match(message: string): SkillDefinition[] {
    const m = message.toLowerCase();
    const out: SkillDefinition[] = [];
    for (const s of this.skills.values()) {
      if (!s.enabled && s.enabled !== undefined) continue;
      if (!s.triggers || s.triggers.length === 0) continue;
      if (s.triggers.some((t) => t && m.includes(t.toLowerCase()))) {
        out.push(s);
      }
    }
    return out;
  }
}
