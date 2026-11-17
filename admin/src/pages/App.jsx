import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';
import HomePage from './HomePage';
import AdminPanelPage from './AdminPanel';
import pluginPermissions from '../permissions';

/**
 * Plugin page router. Strapi mounts this component at
 * `plugins/magic-sessionmanager/*`: the index is the app-user dashboard, and
 * `admin-panel` lists Strapi admin panel sessions. Both need plugin access;
 * the admin panel view also needs `admin-sessions.read`. These checks only
 * decide what is rendered; every API route enforces the same actions.
 *
 * @returns {import('react').ReactElement} Plugin routes.
 */
const App = () => {
  return (
    <Page.Protect permissions={pluginPermissions.access}>
      <Routes>
        <Route index element={<HomePage />} />
        <Route
          path="admin-panel"
          element={
            <Page.Protect permissions={pluginPermissions.adminSessionsRead}>
              <AdminPanelPage />
            </Page.Protect>
          }
        />
        {/* Unknown sub-paths keep showing the dashboard, as before 4.14. */}
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Page.Protect>
  );
};

export default App;
