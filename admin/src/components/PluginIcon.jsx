import { Monitor } from '@strapi/icons';

/**
 * Session Manager icon for the main menu and the homepage widget header.
 * It forwards size and theme `fill` props, so Strapi can render it like its
 * own 16px neutral icons (F13). It is decorative: the menu link and widget
 * title carry the accessible name.
 *
 * @param {import('react').SVGProps<SVGSVGElement> & {fill?: string}} props Icon props from Strapi.
 * @returns {import('react').ReactElement} Monitor icon.
 */
const PluginIcon = (props) => <Monitor aria-hidden focusable={false} {...props} />;

export default PluginIcon;
