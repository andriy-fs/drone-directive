import { Switch as HeadlessSwitch } from '@headlessui/react';
import type { ComponentPropsWithoutRef } from 'react';

export function Switch(props: ComponentPropsWithoutRef<typeof HeadlessSwitch>) {
  return <HeadlessSwitch {...props} />;
}
