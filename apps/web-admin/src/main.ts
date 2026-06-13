import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import BackfillPage from './pages/BackfillPage.vue';
import DashboardPage from './pages/DashboardPage.vue';
import DashboardMonthDetailPage from './pages/DashboardMonthDetailPage.vue';
import MessagesPage from './pages/MessagesPage.vue';
import HistoryDetailPage from './pages/HistoryDetailPage.vue';
import HistoriesPage from './pages/HistoriesPage.vue';
import SchedulesPage from './pages/SchedulesPage.vue';
import UserDetailPage from './pages/UserDetailPage.vue';
import UsersPage from './pages/UsersPage.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: DashboardPage },
    { path: '/dashboard/month/:monthKey', component: DashboardMonthDetailPage },
    { path: '/users', component: UsersPage },
    { path: '/users/:id', component: UserDetailPage },
    { path: '/schedules', component: SchedulesPage },
    { path: '/backfill', component: BackfillPage },
    { path: '/messages', component: MessagesPage },
    { path: '/histories', component: HistoriesPage },
    { path: '/histories/:campaignId', component: HistoryDetailPage },
  ],
});

createApp(App).use(router).mount('#app');
