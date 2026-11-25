import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';
import HomePage from './HomePage';
import AdminPanelPage from './AdminPanel';
import AdminActivityPage from './AdminPanel/ActivityPage';
import pluginPermissions from '../permissions';

/**
 * Plugin page router. Strapi mounts this component at
 * `plugins/magic-sessionmanager/*`: the index is the app-user dashboard, and
 * `admin-panel` lists Strapi admin panel sessions and `admin-panel/activity`
 * shows the sign-in activity of all admins. All need plugin access; the admin
 * panel views also need `admin-sessions.read`, the activity page
 * `admin-activity.read` as well. These checks only
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
        <Route
          path="admin-panel/activity"
          element={
            <Page.Protect permissions={pluginPermissions.adminSessionsRead}>
              <Page.Protect permissions={pluginPermissions.adminActivityRead}>
                <AdminActivityPage />
              </Page.Protect>
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
