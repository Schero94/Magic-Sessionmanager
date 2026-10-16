import { useEffect, useRef } from 'react';
import pluginId from '../pluginId';

/**
 * Registers the plugin with Strapi without taking ownership of administrator
 * session renewal. Strapi Admin manages its own authentication lifecycle.
 *
 * @param {{setPlugin: (pluginId: string) => void}} props Strapi initializer props.
 * @returns {null}
 */
const Initializer = ({ setPlugin }) => {
  const ref = useRef(setPlugin);

  useEffect(() => {
    if (ref.current) {
      ref.current(pluginId);
    }
  }, []);

  return null;
};

export default Initializer;
