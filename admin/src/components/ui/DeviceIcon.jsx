import { Code, Information, Monitor, Phone, Server } from '@strapi/icons';

const DEVICE_ICONS = {
  desktop: Monitor,
  mobile: Phone,
  tablet: Phone,
  api: Code,
  bot: Server,
  unknown: Information,
};

/**
 * @param {string} icon Device icon key from getDevicePresentation().icon.
 * @returns {import('react').ComponentType<any>} DS icon component.
 */
export const getDeviceIconComponent = (icon) => DEVICE_ICONS[icon] || Information;

/**
 * Decorative device icon. The device type is always also given as text.
 *
 * @param {{icon: string}} props Device icon key.
 * @returns {import('react').ReactElement} Hidden-from-AT icon.
 */
const DeviceIcon = ({ icon }) => {
  const Icon = getDeviceIconComponent(icon);
  return <Icon aria-hidden focusable={false} />;
};

export default DeviceIcon;
