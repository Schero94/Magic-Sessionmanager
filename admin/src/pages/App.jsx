import HomePage from './HomePage';
import { Page } from '@strapi/strapi/admin';
import pluginPermissions from '../permissions';

const App = () => {
  return (
    <Page.Protect permissions={pluginPermissions.access}>
      <HomePage />
    </Page.Protect>
  );
};

export default App;
