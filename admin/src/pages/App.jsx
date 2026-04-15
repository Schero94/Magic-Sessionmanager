import HomePage from './HomePage';
import LicenseGuard from '../components/LicenseGuard';
import { Page } from '@strapi/strapi/admin';
import pluginPermissions from '../permissions';

const App = () => {
  return (
    <Page.Protect permissions={pluginPermissions.access}>
      <LicenseGuard>
        <HomePage />
      </LicenseGuard>
    </Page.Protect>
  );
};

export default App;
