export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_settings: {
        Row: {
          active_provider: string
          brand_tone: string
          campaign_id: string | null
          created_at: string
          custom_objective: string | null
          default_hashtags: string[]
          fallback_chain: Json
          id: string
          language: string
          max_caption_length: number
          model: string
          objective: Database["public"]["Enums"]["channel_objective"]
          platform_rules: Json
          provider_mode: string
          providers_config: Json
          temperature: number
          updated_at: string
          user_id: string
          user_instructions: string | null
        }
        Insert: {
          active_provider?: string
          brand_tone?: string
          campaign_id?: string | null
          created_at?: string
          custom_objective?: string | null
          default_hashtags?: string[]
          fallback_chain?: Json
          id?: string
          language?: string
          max_caption_length?: number
          model?: string
          objective?: Database["public"]["Enums"]["channel_objective"]
          platform_rules?: Json
          provider_mode?: string
          providers_config?: Json
          temperature?: number
          updated_at?: string
          user_id: string
          user_instructions?: string | null
        }
        Update: {
          active_provider?: string
          brand_tone?: string
          campaign_id?: string | null
          created_at?: string
          custom_objective?: string | null
          default_hashtags?: string[]
          fallback_chain?: Json
          id?: string
          language?: string
          max_caption_length?: number
          model?: string
          objective?: Database["public"]["Enums"]["channel_objective"]
          platform_rules?: Json
          provider_mode?: string
          providers_config?: Json
          temperature?: number
          updated_at?: string
          user_id?: string
          user_instructions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_settings: {
        Row: {
          created_at: string
          custom_query: string | null
          id: string
          n_value: number
          scope: Database["public"]["Enums"]["analysis_scope"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_query?: string | null
          id?: string
          n_value?: number
          scope?: Database["public"]["Enums"]["analysis_scope"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_query?: string | null
          id?: string
          n_value?: number
          scope?: Database["public"]["Enums"]["analysis_scope"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          attempt: number
          created_at: string
          duration_ms: number | null
          error: string | null
          event_type: string
          id: string
          module: string | null
          payload: Json | null
          queue_item_id: string | null
          run_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          event_type: string
          id?: string
          module?: string | null
          payload?: Json | null
          queue_item_id?: string | null
          run_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          event_type?: string
          id?: string
          module?: string | null
          payload?: Json | null
          queue_item_id?: string | null
          run_id?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      buffer_credentials: {
        Row: {
          api_token: string
          campaign_id: string | null
          created_at: string
          graphql_endpoint: string
          id: string
          label: string
          last_tested_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_token: string
          campaign_id?: string | null
          created_at?: string
          graphql_endpoint?: string
          id?: string
          label?: string
          last_tested_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_token?: string
          campaign_id?: string | null
          created_at?: string
          graphql_endpoint?: string
          id?: string
          label?: string
          last_tested_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "buffer_credentials_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_channel_targets: {
        Row: {
          analysis_custom_query: string | null
          analysis_n_value: number
          analysis_scope: Database["public"]["Enums"]["analysis_scope"]
          campaign_id: string
          channel_id: string
          created_at: string
          id: string
          is_active: boolean
          last_analysis_at: string | null
          last_error: string | null
          last_post_id: string | null
          last_published_at: string | null
          last_refreshed_at: string | null
          learning_state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_custom_query?: string | null
          analysis_n_value?: number
          analysis_scope?: Database["public"]["Enums"]["analysis_scope"]
          campaign_id: string
          channel_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_analysis_at?: string | null
          last_error?: string | null
          last_post_id?: string | null
          last_published_at?: string | null
          last_refreshed_at?: string | null
          learning_state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_custom_query?: string | null
          analysis_n_value?: number
          analysis_scope?: Database["public"]["Enums"]["analysis_scope"]
          campaign_id?: string
          channel_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_analysis_at?: string | null
          last_error?: string | null
          last_post_id?: string | null
          last_published_at?: string | null
          last_refreshed_at?: string | null
          learning_state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_channel_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_channel_targets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_channel_targets_last_post_id_fkey"
            columns: ["last_post_id"]
            isOneToOne: false
            referencedRelation: "published_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          channel_mode: string
          cloudinary_transform: string
          cloudinary_transform_enabled: boolean
          cloudinary_transform_mode: string
          created_at: string
          custom_objective: string | null
          custom_scheduled_at: string | null
          description: string | null
          id: string
          name: string
          objective: string
          publish_delay_minutes: number | null
          publish_mode: string
          sample_caption_mode: string
          share_learning: boolean
          status: string
          updated_at: string
          use_sample_captions: boolean
          user_id: string
        }
        Insert: {
          channel_mode?: string
          cloudinary_transform?: string
          cloudinary_transform_enabled?: boolean
          cloudinary_transform_mode?: string
          created_at?: string
          custom_objective?: string | null
          custom_scheduled_at?: string | null
          description?: string | null
          id?: string
          name: string
          objective?: string
          publish_delay_minutes?: number | null
          publish_mode?: string
          sample_caption_mode?: string
          share_learning?: boolean
          status?: string
          updated_at?: string
          use_sample_captions?: boolean
          user_id: string
        }
        Update: {
          channel_mode?: string
          cloudinary_transform?: string
          cloudinary_transform_enabled?: boolean
          cloudinary_transform_mode?: string
          created_at?: string
          custom_objective?: string | null
          custom_scheduled_at?: string | null
          description?: string | null
          id?: string
          name?: string
          objective?: string
          publish_delay_minutes?: number | null
          publish_mode?: string
          sample_caption_mode?: string
          share_learning?: boolean
          status?: string
          updated_at?: string
          use_sample_captions?: boolean
          user_id?: string
        }
        Relationships: []
      }
      captions: {
        Row: {
          campaign_id: string | null
          created_at: string
          cta: string | null
          emoji_count: number | null
          hashtags: string[] | null
          hook: string | null
          id: string
          length: number | null
          run_id: string
          style_tags: string[] | null
          text: string
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          cta?: string | null
          emoji_count?: number | null
          hashtags?: string[] | null
          hook?: string | null
          id?: string
          length?: number | null
          run_id: string
          style_tags?: string[] | null
          text: string
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          cta?: string | null
          emoji_count?: number | null
          hashtags?: string[] | null
          hook?: string | null
          id?: string
          length?: number | null
          run_id?: string
          style_tags?: string[] | null
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "captions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          active: boolean
          active_run_id: string | null
          buffer_channel_id: string
          campaign_id: string | null
          created_at: string
          credential_id: string | null
          id: string
          last_seen_at: string | null
          lock_expires_at: string | null
          missing_since: string | null
          name: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          active_run_id?: string | null
          buffer_channel_id: string
          campaign_id?: string | null
          created_at?: string
          credential_id?: string | null
          id?: string
          last_seen_at?: string | null
          lock_expires_at?: string | null
          missing_since?: string | null
          name: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          active_run_id?: string | null
          buffer_channel_id?: string
          campaign_id?: string | null
          created_at?: string
          credential_id?: string | null
          id?: string
          last_seen_at?: string | null
          lock_expires_at?: string | null
          missing_since?: string | null
          name?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "buffer_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      content_gallery_items: {
        Row: {
          created_at: string
          id: string
          label: string | null
          media_type: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          media_type: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          media_type?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      formula_run_insights: {
        Row: {
          buffer_post_id: string
          created_at: string
          id: string
          last_synced_at: string | null
          metrics: Json
          metrics_updated_at: string | null
          next_sync_due_at: string | null
          post_type: string
          recurring_schedule_id: string
          run_id: string | null
          sync_attempts: number
          sync_status: string
        }
        Insert: {
          buffer_post_id: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          metrics?: Json
          metrics_updated_at?: string | null
          next_sync_due_at?: string | null
          post_type?: string
          recurring_schedule_id: string
          run_id?: string | null
          sync_attempts?: number
          sync_status?: string
        }
        Update: {
          buffer_post_id?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          metrics?: Json
          metrics_updated_at?: string | null
          next_sync_due_at?: string | null
          post_type?: string
          recurring_schedule_id?: string
          run_id?: string | null
          sync_attempts?: number
          sync_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "formula_run_insights_recurring_schedule_id_fkey"
            columns: ["recurring_schedule_id"]
            isOneToOne: false
            referencedRelation: "recurring_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formula_run_insights_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_trends: {
        Row: {
          baseline: number | null
          campaign_id: string | null
          confidence: number | null
          dimension: string
          human_summary: string | null
          id: string
          last_computed_at: string
          lift_pct: number | null
          metric: string
          observed: number | null
          sample_size: number | null
          user_id: string
          value: string
        }
        Insert: {
          baseline?: number | null
          campaign_id?: string | null
          confidence?: number | null
          dimension: string
          human_summary?: string | null
          id?: string
          last_computed_at?: string
          lift_pct?: number | null
          metric: string
          observed?: number | null
          sample_size?: number | null
          user_id: string
          value: string
        }
        Update: {
          baseline?: number | null
          campaign_id?: string | null
          confidence?: number | null
          dimension?: string
          human_summary?: string | null
          id?: string
          last_computed_at?: string
          lift_pct?: number | null
          metric?: string
          observed?: number | null
          sample_size?: number | null
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_trends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_reports: {
        Row: {
          campaign_id: string | null
          cause: string | null
          change_recommendation: string | null
          created_at: string
          cta_verdict: string | null
          emoji_verdict: string | null
          hashtag_verdict: string | null
          hook_verdict: string | null
          id: string
          length_verdict: string | null
          objective_score: number | null
          prediction_delta: Json | null
          raw: Json | null
          run_id: string
          time_of_day_verdict: string | null
          user_id: string
          worked: boolean | null
        }
        Insert: {
          campaign_id?: string | null
          cause?: string | null
          change_recommendation?: string | null
          created_at?: string
          cta_verdict?: string | null
          emoji_verdict?: string | null
          hashtag_verdict?: string | null
          hook_verdict?: string | null
          id?: string
          length_verdict?: string | null
          objective_score?: number | null
          prediction_delta?: Json | null
          raw?: Json | null
          run_id: string
          time_of_day_verdict?: string | null
          user_id: string
          worked?: boolean | null
        }
        Update: {
          campaign_id?: string | null
          cause?: string | null
          change_recommendation?: string | null
          created_at?: string
          cta_verdict?: string | null
          emoji_verdict?: string | null
          hashtag_verdict?: string | null
          hook_verdict?: string | null
          id?: string
          length_verdict?: string | null
          objective_score?: number | null
          prediction_delta?: Json | null
          raw?: Json | null
          run_id?: string
          time_of_day_verdict?: string | null
          user_id?: string
          worked?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_reports_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_reports_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      logs: {
        Row: {
          created_at: string
          id: number
          level: string
          message: string
          meta: Json | null
          module: string | null
          run_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          level?: string
          message: string
          meta?: Json | null
          module?: string | null
          run_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          level?: string
          message?: string
          meta?: Json | null
          module?: string | null
          run_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_insights: {
        Row: {
          active: boolean
          applicable_topics: string[] | null
          campaign_id: string | null
          category: Database["public"]["Enums"]["insight_category"]
          channel_id: string | null
          confidence: number
          contradiction_count: number
          created_at: string
          id: string
          insight: string
          last_reinforced_at: string
          last_success_at: string | null
          platform: string | null
          support_count: number
          supporting_run_ids: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          applicable_topics?: string[] | null
          campaign_id?: string | null
          category: Database["public"]["Enums"]["insight_category"]
          channel_id?: string | null
          confidence?: number
          contradiction_count?: number
          created_at?: string
          id?: string
          insight: string
          last_reinforced_at?: string
          last_success_at?: string | null
          platform?: string | null
          support_count?: number
          supporting_run_ids?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          applicable_topics?: string[] | null
          campaign_id?: string | null
          category?: Database["public"]["Enums"]["insight_category"]
          channel_id?: string | null
          confidence?: number
          contradiction_count?: number
          created_at?: string
          id?: string
          insight?: string
          last_reinforced_at?: string
          last_success_at?: string | null
          platform?: string | null
          support_count?: number
          supporting_run_ids?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_insights_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      multi_channel_rounds: {
        Row: {
          campaign_id: string
          channel_count: number
          completed_count: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          queue_item_id: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          channel_count?: number
          completed_count?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          queue_item_id: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          channel_count?: number
          completed_count?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          queue_item_id?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "multi_channel_rounds_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "multi_channel_rounds_queue_item_id_fkey"
            columns: ["queue_item_id"]
            isOneToOne: false
            referencedRelation: "video_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      multi_channel_schedules: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          interval_hours: number
          is_active: boolean
          last_error: string | null
          last_run_at: string | null
          next_run_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          interval_hours: number
          is_active?: boolean
          last_error?: string | null
          last_run_at?: string | null
          next_run_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          interval_hours?: number
          is_active?: boolean
          last_error?: string | null
          last_run_at?: string | null
          next_run_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "multi_channel_schedules_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      post_analytics: {
        Row: {
          campaign_id: string | null
          comments: number | null
          fetched_at: string
          id: string
          impressions: number | null
          likes: number | null
          published_post_id: string
          raw: Json | null
          reach: number | null
          saves: number | null
          shares: number | null
          user_id: string
          views: number | null
        }
        Insert: {
          campaign_id?: string | null
          comments?: number | null
          fetched_at?: string
          id?: string
          impressions?: number | null
          likes?: number | null
          published_post_id: string
          raw?: Json | null
          reach?: number | null
          saves?: number | null
          shares?: number | null
          user_id: string
          views?: number | null
        }
        Update: {
          campaign_id?: string | null
          comments?: number | null
          fetched_at?: string
          id?: string
          impressions?: number | null
          likes?: number | null
          published_post_id?: string
          raw?: Json | null
          reach?: number | null
          saves?: number | null
          shares?: number | null
          user_id?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_analytics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_analytics_published_post_id_fkey"
            columns: ["published_post_id"]
            isOneToOne: false
            referencedRelation: "published_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          accuracy_score: number | null
          actual_comments: number | null
          actual_likes: number | null
          actual_reach: number | null
          actual_saves: number | null
          actual_shares: number | null
          actual_views: number | null
          campaign_id: string | null
          confidence: number | null
          created_at: string
          evaluated_at: string | null
          id: string
          predicted_comments: number | null
          predicted_likes: number | null
          predicted_reach: number | null
          predicted_saves: number | null
          predicted_shares: number | null
          predicted_views: number | null
          rationale: string | null
          raw: Json | null
          run_id: string | null
          user_id: string
        }
        Insert: {
          accuracy_score?: number | null
          actual_comments?: number | null
          actual_likes?: number | null
          actual_reach?: number | null
          actual_saves?: number | null
          actual_shares?: number | null
          actual_views?: number | null
          campaign_id?: string | null
          confidence?: number | null
          created_at?: string
          evaluated_at?: string | null
          id?: string
          predicted_comments?: number | null
          predicted_likes?: number | null
          predicted_reach?: number | null
          predicted_saves?: number | null
          predicted_shares?: number | null
          predicted_views?: number | null
          rationale?: string | null
          raw?: Json | null
          run_id?: string | null
          user_id: string
        }
        Update: {
          accuracy_score?: number | null
          actual_comments?: number | null
          actual_likes?: number | null
          actual_reach?: number | null
          actual_saves?: number | null
          actual_shares?: number | null
          actual_views?: number | null
          campaign_id?: string | null
          confidence?: number | null
          created_at?: string
          evaluated_at?: string | null
          id?: string
          predicted_comments?: number | null
          predicted_likes?: number | null
          predicted_reach?: number | null
          predicted_saves?: number | null
          predicted_shares?: number | null
          predicted_views?: number | null
          rationale?: string | null
          raw?: Json | null
          run_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          active: boolean
          caption_prompt: string
          created_at: string
          id: string
          learning_prompt: string
          name: string
          notes: string | null
          user_id: string | null
          version: number
          vision_prompt: string
        }
        Insert: {
          active?: boolean
          caption_prompt: string
          created_at?: string
          id?: string
          learning_prompt: string
          name: string
          notes?: string | null
          user_id?: string | null
          version: number
          vision_prompt: string
        }
        Update: {
          active?: boolean
          caption_prompt?: string
          created_at?: string
          id?: string
          learning_prompt?: string
          name?: string
          notes?: string | null
          user_id?: string | null
          version?: number
          vision_prompt?: string
        }
        Relationships: []
      }
      published_posts: {
        Row: {
          buffer_post_id: string | null
          buffer_status: string | null
          campaign_id: string | null
          channel_id: string | null
          created_at: string
          due_at: string | null
          id: string
          metrics_updated_at: string | null
          permalink: string | null
          platform: string | null
          posted_at: string | null
          raw: Json | null
          run_id: string | null
          source: string
          text_content: string | null
          user_id: string
          verified_at: string | null
        }
        Insert: {
          buffer_post_id?: string | null
          buffer_status?: string | null
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          metrics_updated_at?: string | null
          permalink?: string | null
          platform?: string | null
          posted_at?: string | null
          raw?: Json | null
          run_id?: string | null
          source?: string
          text_content?: string | null
          user_id: string
          verified_at?: string | null
        }
        Update: {
          buffer_post_id?: string | null
          buffer_status?: string | null
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          metrics_updated_at?: string | null
          permalink?: string | null
          platform?: string | null
          posted_at?: string | null
          raw?: Json | null
          run_id?: string | null
          source?: string
          text_content?: string | null
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "published_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_posts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "published_posts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_schedule_items: {
        Row: {
          caption: string
          created_at: string
          id: string
          media_url: string
          position: number
          schedule_id: string
          updated_at: string
        }
        Insert: {
          caption?: string
          created_at?: string
          id?: string
          media_url: string
          position: number
          schedule_id: string
          updated_at?: string
        }
        Update: {
          caption?: string
          created_at?: string
          id?: string
          media_url?: string
          position?: number
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_schedule_items_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "recurring_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_schedules: {
        Row: {
          allow_comments: boolean
          allow_duet: boolean
          allow_stitch: boolean
          campaign_id: string | null
          caption: string
          channel_id: string
          cloudinary_transform: string
          cloudinary_transform_enabled: boolean
          cloudinary_transform_mode: string
          created_at: string
          custom_schedule_at: string | null
          custom_schedule_offset_minutes: number | null
          daily_times: Json
          id: string
          interval_hours: number
          is_active: boolean
          last_claimed_slot: string | null
          last_error: string | null
          last_published_item_id: string | null
          last_run_at: string | null
          last_run_id: string | null
          media_url: string
          mode: string
          next_run_at: string | null
          platform: string
          post_type: string
          privacy_level: string | null
          publish_mode: string
          scheduler_mode: string
          share_to_feed: boolean
          start_at: string | null
          thumbnail_timestamp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_comments?: boolean
          allow_duet?: boolean
          allow_stitch?: boolean
          campaign_id?: string | null
          caption?: string
          channel_id: string
          cloudinary_transform?: string
          cloudinary_transform_enabled?: boolean
          cloudinary_transform_mode?: string
          created_at?: string
          custom_schedule_at?: string | null
          custom_schedule_offset_minutes?: number | null
          daily_times?: Json
          id?: string
          interval_hours: number
          is_active?: boolean
          last_claimed_slot?: string | null
          last_error?: string | null
          last_published_item_id?: string | null
          last_run_at?: string | null
          last_run_id?: string | null
          media_url: string
          mode?: string
          next_run_at?: string | null
          platform: string
          post_type: string
          privacy_level?: string | null
          publish_mode?: string
          scheduler_mode?: string
          share_to_feed?: boolean
          start_at?: string | null
          thumbnail_timestamp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_comments?: boolean
          allow_duet?: boolean
          allow_stitch?: boolean
          campaign_id?: string | null
          caption?: string
          channel_id?: string
          cloudinary_transform?: string
          cloudinary_transform_enabled?: boolean
          cloudinary_transform_mode?: string
          created_at?: string
          custom_schedule_at?: string | null
          custom_schedule_offset_minutes?: number | null
          daily_times?: Json
          id?: string
          interval_hours?: number
          is_active?: boolean
          last_claimed_slot?: string | null
          last_error?: string | null
          last_published_item_id?: string | null
          last_run_at?: string | null
          last_run_id?: string | null
          media_url?: string
          mode?: string
          next_run_at?: string | null
          platform?: string
          post_type?: string
          privacy_level?: string | null
          publish_mode?: string
          scheduler_mode?: string
          share_to_feed?: boolean
          start_at?: string | null
          thumbnail_timestamp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_schedules_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_schedules_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_schedules_last_published_item_fk"
            columns: ["last_published_item_id"]
            isOneToOne: false
            referencedRelation: "recurring_schedule_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_schedules_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          attempts: number
          campaign_id: string | null
          channel_id: string | null
          created_at: string
          current_step: string | null
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          next_strategy: string | null
          prediction_id: string | null
          prompt_version_id: string | null
          queue_item_id: string | null
          run_number: number
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          step_state: Json
          strategy_id: string | null
          strategy_used: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          current_step?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          next_strategy?: string | null
          prediction_id?: string | null
          prompt_version_id?: string | null
          queue_item_id?: string | null
          run_number: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          step_state?: Json
          strategy_id?: string | null
          strategy_used?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          campaign_id?: string | null
          channel_id?: string | null
          created_at?: string
          current_step?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          next_strategy?: string | null
          prediction_id?: string | null
          prompt_version_id?: string | null
          queue_item_id?: string | null
          run_number?: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          step_state?: Json
          strategy_id?: string | null
          strategy_used?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_queue_item_id_fkey"
            columns: ["queue_item_id"]
            isOneToOne: false
            referencedRelation: "video_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_captions: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          is_active: boolean
          text: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          text: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sample_captions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          active: boolean
          campaign_id: string | null
          channel_id: string
          created_at: string
          custom_scheduled_at: string | null
          daily_times: string[]
          id: string
          interval_hours: number | null
          last_run_at: string | null
          mode: Database["public"]["Enums"]["schedule_mode"]
          next_run_at: string | null
          paused: boolean
          publish_delay_minutes: number | null
          publish_mode: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          campaign_id?: string | null
          channel_id: string
          created_at?: string
          custom_scheduled_at?: string | null
          daily_times?: string[]
          id?: string
          interval_hours?: number | null
          last_run_at?: string | null
          mode?: Database["public"]["Enums"]["schedule_mode"]
          next_run_at?: string | null
          paused?: boolean
          publish_delay_minutes?: number | null
          publish_mode?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          campaign_id?: string | null
          channel_id?: string
          created_at?: string
          custom_scheduled_at?: string | null
          daily_times?: string[]
          id?: string
          interval_hours?: number | null
          last_run_at?: string | null
          mode?: Database["public"]["Enums"]["schedule_mode"]
          next_run_at?: string | null
          paused?: boolean
          publish_delay_minutes?: number | null
          publish_mode?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          analytics_delay_h: number
          created_at: string
          id: string
          max_retries: number
          notifications: Json
          rate_limit_per_min: number
          retry_interval_s: number
          updated_at: string
          user_id: string
        }
        Insert: {
          analytics_delay_h?: number
          created_at?: string
          id?: string
          max_retries?: number
          notifications?: Json
          rate_limit_per_min?: number
          retry_interval_s?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          analytics_delay_h?: number
          created_at?: string
          id?: string
          max_retries?: number
          notifications?: Json
          rate_limit_per_min?: number
          retry_interval_s?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sheet_mode_channel_targets: {
        Row: {
          added_at: string
          backfill_applied: boolean
          buffer_connection_id: string
          channel_id: string
          channel_label: string
          customization: Json
          id: string
          is_active: boolean
          platform: string
          removed_at: string | null
          sheet_id: string
        }
        Insert: {
          added_at?: string
          backfill_applied?: boolean
          buffer_connection_id: string
          channel_id: string
          channel_label: string
          customization?: Json
          id?: string
          is_active?: boolean
          platform: string
          removed_at?: string | null
          sheet_id: string
        }
        Update: {
          added_at?: string
          backfill_applied?: boolean
          buffer_connection_id?: string
          channel_id?: string
          channel_label?: string
          customization?: Json
          id?: string
          is_active?: boolean
          platform?: string
          removed_at?: string | null
          sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_mode_channel_targets_buffer_connection_id_fkey"
            columns: ["buffer_connection_id"]
            isOneToOne: false
            referencedRelation: "buffer_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_mode_channel_targets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_mode_channel_targets_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "sheet_mode_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_mode_row_channel_status: {
        Row: {
          channel_target_id: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          published_at: string | null
          published_post_id: string | null
          published_url: string | null
          row_id: string
          status: string
        }
        Insert: {
          channel_target_id: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          published_at?: string | null
          published_post_id?: string | null
          published_url?: string | null
          row_id: string
          status?: string
        }
        Update: {
          channel_target_id?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          published_at?: string | null
          published_post_id?: string | null
          published_url?: string | null
          row_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_mode_row_channel_status_channel_target_id_fkey"
            columns: ["channel_target_id"]
            isOneToOne: false
            referencedRelation: "sheet_mode_channel_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_mode_row_channel_status_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "sheet_mode_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_mode_rows: {
        Row: {
          caption: string
          created_at: string
          id: string
          position: number
          priority: number | null
          sheet_id: string
          status: string
          updated_at: string
          video_url: string
          weight: number | null
        }
        Insert: {
          caption?: string
          created_at?: string
          id?: string
          position: number
          priority?: number | null
          sheet_id: string
          status?: string
          updated_at?: string
          video_url?: string
          weight?: number | null
        }
        Update: {
          caption?: string
          created_at?: string
          id?: string
          position?: number
          priority?: number | null
          sheet_id?: string
          status?: string
          updated_at?: string
          video_url?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_mode_rows_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "sheet_mode_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_mode_sheets: {
        Row: {
          after_publish_mark_status: boolean
          after_publish_save_post_id: boolean
          after_publish_save_time: boolean
          after_publish_save_url: boolean
          cloudinary_transform: string
          cloudinary_transform_enabled: boolean
          cloudinary_transform_mode: string
          created_at: string
          custom_schedule_at: string | null
          custom_schedule_offset_minutes: number | null
          daily_times: Json
          id: string
          is_enabled: boolean
          name: string
          next_run_at: string | null
          publish_mode: string
          retry_failed: boolean
          rows_per_run: number
          schedule_label: string | null
          scheduler_interval_hours: number
          scheduler_mode: string
          selection_rule: string
          updated_at: string
          user_id: string
        }
        Insert: {
          after_publish_mark_status?: boolean
          after_publish_save_post_id?: boolean
          after_publish_save_time?: boolean
          after_publish_save_url?: boolean
          cloudinary_transform?: string
          cloudinary_transform_enabled?: boolean
          cloudinary_transform_mode?: string
          created_at?: string
          custom_schedule_at?: string | null
          custom_schedule_offset_minutes?: number | null
          daily_times?: Json
          id?: string
          is_enabled?: boolean
          name: string
          next_run_at?: string | null
          publish_mode?: string
          retry_failed?: boolean
          rows_per_run?: number
          schedule_label?: string | null
          scheduler_interval_hours?: number
          scheduler_mode?: string
          selection_rule?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          after_publish_mark_status?: boolean
          after_publish_save_post_id?: boolean
          after_publish_save_time?: boolean
          after_publish_save_url?: boolean
          cloudinary_transform?: string
          cloudinary_transform_enabled?: boolean
          cloudinary_transform_mode?: string
          created_at?: string
          custom_schedule_at?: string | null
          custom_schedule_offset_minutes?: number | null
          daily_times?: Json
          id?: string
          is_enabled?: boolean
          name?: string
          next_run_at?: string | null
          publish_mode?: string
          retry_failed?: boolean
          rows_per_run?: number
          schedule_label?: string | null
          scheduler_interval_hours?: number
          scheduler_mode?: string
          selection_rule?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      strategies: {
        Row: {
          campaign_id: string | null
          caption_length: string | null
          created_at: string
          cta_type: string | null
          education_level: string | null
          emoji_level: string | null
          hashtag_count: number | null
          hook_style: string | null
          id: string
          memory_refs: string[] | null
          objective: string | null
          posting_time_hint: string | null
          raw: Json | null
          reasoning: string | null
          run_id: string | null
          storytelling: boolean | null
          tone: string | null
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          caption_length?: string | null
          created_at?: string
          cta_type?: string | null
          education_level?: string | null
          emoji_level?: string | null
          hashtag_count?: number | null
          hook_style?: string | null
          id?: string
          memory_refs?: string[] | null
          objective?: string | null
          posting_time_hint?: string | null
          raw?: Json | null
          reasoning?: string | null
          run_id?: string | null
          storytelling?: boolean | null
          tone?: string | null
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          caption_length?: string | null
          created_at?: string
          cta_type?: string | null
          education_level?: string | null
          emoji_level?: string | null
          hashtag_count?: number | null
          hook_style?: string | null
          id?: string
          memory_refs?: string[] | null
          objective?: string | null
          posting_time_hint?: string | null
          raw?: Json | null
          reasoning?: string | null
          run_id?: string | null
          storytelling?: boolean | null
          tone?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategies_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategies_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      video_analyses: {
        Row: {
          actions: string[] | null
          campaign_id: string | null
          created_at: string
          emotions: string[] | null
          id: string
          message: string | null
          objects: string[] | null
          people: string | null
          raw: Json | null
          run_id: string
          scene: string | null
          story: string | null
          summary: string | null
          topic: string | null
          user_id: string
        }
        Insert: {
          actions?: string[] | null
          campaign_id?: string | null
          created_at?: string
          emotions?: string[] | null
          id?: string
          message?: string | null
          objects?: string[] | null
          people?: string | null
          raw?: Json | null
          run_id: string
          scene?: string | null
          story?: string | null
          summary?: string | null
          topic?: string | null
          user_id: string
        }
        Update: {
          actions?: string[] | null
          campaign_id?: string | null
          created_at?: string
          emotions?: string[] | null
          id?: string
          message?: string | null
          objects?: string[] | null
          people?: string | null
          raw?: Json | null
          run_id?: string
          scene?: string | null
          story?: string | null
          summary?: string | null
          topic?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_analyses_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_analyses_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      video_queue: {
        Row: {
          added_at: string
          attempts: number
          campaign_id: string | null
          channel_id: string | null
          cloudinary_url: string
          dead_letter_at: string | null
          error: string | null
          id: string
          idempotency_key: string | null
          last_error_module: string | null
          max_attempts: number
          position: number
          processed_at: string | null
          status: Database["public"]["Enums"]["queue_status"]
          user_id: string
        }
        Insert: {
          added_at?: string
          attempts?: number
          campaign_id?: string | null
          channel_id?: string | null
          cloudinary_url: string
          dead_letter_at?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string | null
          last_error_module?: string | null
          max_attempts?: number
          position: number
          processed_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          user_id: string
        }
        Update: {
          added_at?: string
          attempts?: number
          campaign_id?: string | null
          channel_id?: string | null
          cloudinary_url?: string
          dead_letter_at?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string | null
          last_error_module?: string | null
          max_attempts?: number
          position?: number
          processed_at?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_queue_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_queue_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_formula_insight_sync: {
        Args: { _insight_id: string; _now: string }
        Returns: boolean
      }
      claim_multi_channel_queue_item: {
        Args: { _campaign_id: string; _queue_item_id: string }
        Returns: boolean
      }
      claim_multi_channel_schedule: {
        Args: { _next_run_at: string; _now: string; _schedule_id: string }
        Returns: boolean
      }
      claim_recurring_schedule_slot: {
        Args: {
          _now?: string
          _run_id: string
          _schedule_id: string
          _slot_key: string
        }
        Returns: boolean
      }
      claim_schedule_slot: {
        Args: { _next_run_at: string; _now: string; _schedule_id: string }
        Returns: boolean
      }
      claim_sheet_mode_channel: {
        Args: {
          _channel_target_id: string
          _now: string
          _row_id: string
          _stale_before: string
        }
        Returns: boolean
      }
      claim_sheet_mode_schedule: {
        Args: { _next_run_at: string; _now: string; _sheet_id: string }
        Returns: boolean
      }
      move_recurring_schedule_item: {
        Args: { _direction: string; _item_id: string }
        Returns: boolean
      }
      release_channel_lock: {
        Args: { _channel_id: string; _run_id: string }
        Returns: undefined
      }
      try_claim_channel_lock: {
        Args: { _channel_id: string; _run_id: string; _ttl_seconds: number }
        Returns: boolean
      }
    }
    Enums: {
      analysis_scope:
        | "last_n"
        | "top_n"
        | "highest_engagement"
        | "highest_views"
        | "highest_saves"
        | "all"
        | "custom"
      channel_objective:
        | "followers"
        | "likes"
        | "comments"
        | "shares"
        | "saves"
        | "watch_time"
        | "profile_visits"
        | "ctr"
        | "reach"
        | "engagement"
        | "brand_awareness"
        | "custom"
      insight_category:
        | "hook"
        | "length"
        | "emoji"
        | "hashtag"
        | "cta"
        | "topic"
        | "style"
        | "timing"
        | "other"
      queue_status:
        | "pending"
        | "processing"
        | "done"
        | "failed"
        | "skipped"
        | "dead_letter"
      run_status:
        | "pending"
        | "analyzing"
        | "generating"
        | "publishing"
        | "awaiting_analytics"
        | "complete"
        | "failed"
        | "stale"
      schedule_mode: "interval" | "daily_times" | "manual"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      analysis_scope: [
        "last_n",
        "top_n",
        "highest_engagement",
        "highest_views",
        "highest_saves",
        "all",
        "custom",
      ],
      channel_objective: [
        "followers",
        "likes",
        "comments",
        "shares",
        "saves",
        "watch_time",
        "profile_visits",
        "ctr",
        "reach",
        "engagement",
        "brand_awareness",
        "custom",
      ],
      insight_category: [
        "hook",
        "length",
        "emoji",
        "hashtag",
        "cta",
        "topic",
        "style",
        "timing",
        "other",
      ],
      queue_status: [
        "pending",
        "processing",
        "done",
        "failed",
        "skipped",
        "dead_letter",
      ],
      run_status: [
        "pending",
        "analyzing",
        "generating",
        "publishing",
        "awaiting_analytics",
        "complete",
        "failed",
        "stale",
      ],
      schedule_mode: ["interval", "daily_times", "manual"],
    },
  },
} as const
