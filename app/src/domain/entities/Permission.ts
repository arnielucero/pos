export const PERMISSIONS = [
  'sale.create',
  'sale.void',
  'sale.refund',
  'sale.reprint',
  'discount.apply',
  'price.override',
  'inventory.view',
  'inventory.adjust',
  'product.edit',
  'report.view',
  'register.open',
  'register.close',
  'settings.edit',
  'device.register',
  'approval.grant',
  'sync.diagnostics',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface PermissionHolder {
  readonly permissions: readonly string[];
}

export function hasPermission(holder: PermissionHolder | null | undefined, permission: Permission): boolean {
  return holder?.permissions.includes(permission) ?? false;
}
