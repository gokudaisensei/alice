<script lang="ts">
	import Page from '#lib/components/app/Page.svelte';
	import NotificationSettings from '#lib/components/app/NotificationSettings.svelte';
</script>

<Page title="Notifications" subtitle="Only you see these choices." back={{ href: '/you', label: 'You' }} width="md">
	<NotificationSettings />
</Page>
