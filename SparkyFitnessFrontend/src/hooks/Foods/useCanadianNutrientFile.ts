import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCnfStatus,
  triggerCnfBulkImport,
  deleteCnfLibrary,
  type TriggerCnfBulkImportParams,
} from '@/api/Foods/canadianNutrientFile';
import { useToast } from '@/hooks/use-toast';

export const cnfKeys = {
  status: ['canadianNutrientFile', 'status'] as const,
};

export function useCnfStatusQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: cnfKeys.status,
    queryFn: fetchCnfStatus,
    refetchInterval: (query) => {
      const isRunning = query.state.data?.isRunning;
      return isRunning ? 2000 : false;
    },
    enabled: options?.enabled,
  });
}

export function useCnfBulkImportMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (params: TriggerCnfBulkImportParams) =>
      triggerCnfBulkImport(params),
    onSuccess: (data) => {
      toast({
        title: 'Canadian Nutrient File Import',
        description: data.message || 'Import processed successfully.',
      });
      queryClient.invalidateQueries({ queryKey: cnfKeys.status });
      queryClient.invalidateQueries({ queryKey: ['foods'] });
      queryClient.invalidateQueries({ queryKey: ['foodSearch'] });
      queryClient.invalidateQueries({ queryKey: ['foodsV2'] });
      queryClient.invalidateQueries({ queryKey: ['dailySummary'] });
      queryClient.invalidateQueries({ queryKey: ['foodEntries'] });
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : 'Import failed to start.';
      toast({
        title: 'Import Error',
        description: message,
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteCnfLibraryMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: deleteCnfLibrary,
    onSuccess: (data) => {
      toast({
        title: 'Canadian Nutrient File Library Cleared',
        description: `Successfully removed ${data.deletedCount} food items from your library.`,
      });
      queryClient.invalidateQueries({ queryKey: ['foods'] });
      queryClient.invalidateQueries({ queryKey: ['foodSearch'] });
      queryClient.invalidateQueries({ queryKey: ['foodsV2'] });
      queryClient.invalidateQueries({ queryKey: cnfKeys.status });
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to clear library foods.';
      toast({
        title: 'Deletion Error',
        description: message,
        variant: 'destructive',
      });
    },
  });
}
