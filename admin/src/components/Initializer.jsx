import { useEffect } from 'react';

const Initializer = () => {
  useEffect(() => {
    console.log('[magic-sessionmanager] Plugin initialized');
  }, []);

  return null;
};

export default Initializer;
