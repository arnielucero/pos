import { createContext, useContext } from 'react';
import type { Container } from '../../app/container';

export const ContainerContext = createContext<Container | null>(null);

/** Resolves the DI container. Components reach use cases only through this. */
export function useContainer(): Container {
  const c = useContext(ContainerContext);
  if (!c) throw new Error('ContainerContext missing');
  return c;
}
