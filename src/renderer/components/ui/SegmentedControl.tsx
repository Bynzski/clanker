import type { ComponentProps } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import './SegmentedControl.css';

export function SegmentedControl({ className = '', ...props }: ComponentProps<typeof RadioGroup.Root>) {
  return <RadioGroup.Root {...props} className={`clanker-segmented-control ${className}`} />;
}

export function SegmentedControlItem({ className = '', ...props }: ComponentProps<typeof RadioGroup.Item>) {
  return <RadioGroup.Item {...props} className={`clanker-segmented-item ${className}`} />;
}
