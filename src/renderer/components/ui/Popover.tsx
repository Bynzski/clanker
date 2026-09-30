import type { ComponentProps } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { BrowserOverlayLease } from './dialogLifecycle';
import './Popover.css';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export type PopoverContentProps = Omit<ComponentProps<typeof RadixPopover.Content>, 'asChild'> & {
  workspaceId?: string;
};

export function PopoverContent({ workspaceId, className = '', children, sideOffset = 4, collisionPadding = 8, ...props }: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content {...props} sideOffset={sideOffset} collisionPadding={collisionPadding}
        className={`clanker-popover-content ${className}`}>
        <BrowserOverlayLease workspaceId={workspaceId} />
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
