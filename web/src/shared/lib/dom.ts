/** Typed `getElementById`, so a typo fails loudly instead of rendering nowhere. */
export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element as T;
}
